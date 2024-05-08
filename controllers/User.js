import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { createError } from "../error.js";
import User from "../models/User.js";
import Workout from "../models/Workout.js";

dotenv.config();

export const UserRegister = async (req, res, next) => {
  try {
    const { email, password, name, img } = req.body;

    // Check if the email is in use
    const existingUser = await User.findOne({ email }).exec();
    if (existingUser) {
      return next(createError(409, "Email is already in use."));
    }

    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(password, salt);

    const user = new User({
      name,
      email,
      password: hashedPassword,
      img,
    });
    const createdUser = await user.save();
    const token = jwt.sign({ id: createdUser._id }, process.env.JWT, {
      expiresIn: "9999 years",
    });
    return res.status(200).json({ token, user });
  } catch (error) {
    return next(error);
  }
};

export const UserLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email: email });
    // Check if user exists
    if (!user) {
      return next(createError(404, "User not found"));
    }

    // Check if password is correct
    const isPasswordCorrect = await bcrypt.compareSync(password, user.password);
    if (!isPasswordCorrect) {
      return next(createError(403, "Incorrect password"));
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT, {
      expiresIn: "9999 years",
    });

    return res.status(200).json({ token, user });
  } catch (error) {
    return next(error);
  }
};

export const getUserDashboard = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const user = await User.findById(userId);
    if (!user) {
      return next(createError(404, "User not found"));
    }

    const currentDateFormatted = new Date();
    const startToday = new Date(
      currentDateFormatted.getFullYear(),
      currentDateFormatted.getMonth(),
      currentDateFormatted.getDate()
    );
    const endToday = new Date(
      currentDateFormatted.getFullYear(),
      currentDateFormatted.getMonth(),
      currentDateFormatted.getDate() + 1
    );

    // Calculate total calories burnt
    const totalCaloriesBurnt = await Workout.aggregate([
      { $match: { user: user._id, date: { $gte: startToday, $lt: endToday } } },
      {
        $group: {
          _id: null,
          totalCaloriesBurnt: { $sum: "$caloriesBurned" },
        },
      },
    ]);

    // Calculate total number of workouts
    const totalWorkouts = await Workout.countDocuments({
      user: userId,
      date: { $gte: startToday, $lt: endToday },
    });

    // Calculate average calories burnt per workout
    const avgCaloriesBurntPerWorkout =
      totalCaloriesBurnt.length > 0
        ? totalCaloriesBurnt[0].totalCaloriesBurnt / totalWorkouts
        : 0;

    // Fetch category of workouts
    const categoryCalories = await Workout.aggregate([
      { $match: { user: user._id, date: { $gte: startToday, $lt: endToday } } },
      {
        $group: {
          _id: "$category",
          totalCaloriesBurnt: { $sum: "$caloriesBurned" },
        },
      },
    ]);

    // Format category data for pie chart

    const pieChartData = categoryCalories.map((category, index) => ({
      id: index,
      value: category.totalCaloriesBurnt,
      label: category._id,
    }));

    const weeks = [];
    const caloriesBurnt = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(
        currentDateFormatted.getTime() - i * 24 * 60 * 60 * 1000
      );
      weeks.push(`${date.getDate()}th`);

      const startOfDay = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
      );
      const endOfDay = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate() + 1
      );

      const weekData = await Workout.aggregate([
        {
          $match: {
            user: user._id,
            date: { $gte: startOfDay, $lt: endOfDay },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
            totalCaloriesBurnt: { $sum: "$caloriesBurned" },
          },
        },
        {
          $sort: { _id: 1 }, // Sort by date in ascending order
        },
      ]);

      caloriesBurnt.push(
        weekData[0]?.totalCaloriesBurnt ? weekData[0]?.totalCaloriesBurnt : 0
      );
    }

    return res.status(200).json({
      totalCaloriesBurnt:
        totalCaloriesBurnt.length > 0
          ? totalCaloriesBurnt[0].totalCaloriesBurnt
          : 0,
      totalWorkouts: totalWorkouts,
      avgCaloriesBurntPerWorkout: avgCaloriesBurntPerWorkout,
      totalWeeksCaloriesBurnt: {
        weeks: weeks,
        caloriesBurned: caloriesBurnt,
      },
      pieChartData: pieChartData,
    });
  } catch (err) {
    next(err);
  }
};

export const getWorkoutsByDate = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const user = await User.findById(userId);
    let date = req.query.date ? new Date(req.query.date) : new Date();
    if (!user) {
      return next(createError(404, "User not found"));
    }
    const startOfDay = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    );
    const endOfDay = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate() + 1
    );

    const todaysWorkouts = await Workout.find({
      user: userId, // Filter by user
      date: { $gte: startOfDay, $lt: endOfDay },
    });

    const totalCaloriesBurnt = todaysWorkouts.reduce(
      (total, workout) => total + workout.caloriesBurned,
      0
    );

    return res.status(200).json({ todaysWorkouts, totalCaloriesBurnt });
  } catch (err) {
    next(err);
  }
};


export const addWorkout = async (req, res, next) => {
  try {
    const userId = req.user?.id; // Retrieve user ID from the request
    if (!userId) {
      return next(createError(401, "Unauthorized")); // Check if user is authenticated
    }

    const { workoutString } = req.body;
    if (!workoutString) {
      return next(createError(400, "Workout string is missing"));
    }

    const eachWorkout = workoutString.split(";").map(line => line.trim());
    const parsedWorkouts = [];
    let currentCategory = "";
    let count = 0;

    eachWorkout.forEach(line => {
      count++;
      if (line.startsWith("#")) {
        const parts = line.split("\n").map(part => part.trim());
        if (parts.length < 5) {
          return next(createError(400, `Workout string is missing details for ${count}th workout`));
        }

        currentCategory = parts[0].substring(1).trim();
        const workoutDetails = parseWorkoutLine(parts);
        if (!workoutDetails) {
          return next(createError(400, `Please enter proper format for ${count}th workout`));
        }

        workoutDetails.category = currentCategory;
        parsedWorkouts.push(workoutDetails);
      } else {
        return next(createError(400, `Workout string is missing details for ${count}th workout`));
      }
    });

    const workoutsToAdd = parsedWorkouts.map(workout => ({
      ...workout,
      caloriesBurned: calculateCaloriesBurnt(workout),
      user: userId, // Add user reference to each workout
    }));

    if (workoutsToAdd.length === 0) {
      return next(createError(400, "No valid workouts found in the workout string"));
    }

    await Workout.insertMany(workoutsToAdd);

    return res.status(201).json({
      success: true,
      message: "Workouts added successfully",
      workouts: parsedWorkouts,
    });
  } catch (err) {
    next(err);
  }
};


// export const addWorkout = async (req, res, next) => {
//   try {
//     const userId = req.user?.id;
//     const user = await User.findById(userId);
    
//     if (!user) {
//       return next(createError(404, "User not found"));
//     }

//     const { workoutString } = req.body;
//     if (!workoutString) {
//       return next(createError(400, "Workout string is missing"));
//     }

//     const eachWorkout = workoutString.split(";").map(line => line.trim());
//     const parsedWorkouts = [];
//     let currentCategory = "";
//     let count = 0;

//     eachWorkout.forEach(line => {
//       count++;
//       if (line.startsWith("#")) {
//         const parts = line.split("\n").map(part => part.trim());
//         if (parts.length < 5) {
//           return next(createError(400, `Workout string is missing details for ${count}th workout`));
//         }

//         currentCategory = parts[0].substring(1).trim();
//         const workoutDetails = parseWorkoutLine(parts);
//         if (!workoutDetails) {
//           return next(createError(400, `Please enter proper format for ${count}th workout`));
//         }

//         workoutDetails.category = currentCategory;
//         parsedWorkouts.push(workoutDetails);
//       } else {
//         return next(createError(400, `Workout string is missing details for ${count}th workout`));
//       }
//     });

//     const workoutsToAdd = parsedWorkouts.map(workout => ({
//       ...workout,
//       caloriesBurned: calculateCaloriesBurnt(workout),
//       user: userId
//     }));

//     if (workoutsToAdd.length === 0) {
//       return next(createError(400, "No valid workouts found in the workout string"));
//     }

//     await Workout.insertMany(workoutsToAdd);

//     return res.status(201).json({
//       success: true,
//       message: "Workouts added successfully",
//       workouts: parsedWorkouts,
//     });
//   } catch (err) {
//     next(err);
//   }
// };

// // Function to parse workout details from a line
// const parseWorkoutLine = (parts) => {
//   const details = {};
//   if (parts.length >= 5) {
//     details.workoutName = parts[1].substring(1).trim();
//     details.sets = parseInt(parts[2].split("sets")[0].substring(1).trim());
//     details.reps = parseInt(
//       parts[2].split("sets")[1].split("reps")[0].substring(1).trim()
//     );
//     details.weight = parseFloat(parts[3].split("kg")[0].substring(1).trim());
//     details.duration = parseFloat(parts[4].split("min")[0].substring(1).trim());
//     return details;
//   }
//   return null;
// };

// Function to calculate calories burnt for a workout
const calculateCaloriesBurnt = (workoutDetails) => {
  const durationInMinutes = parseInt(workoutDetails.duration);
  const weightInKg = parseInt(workoutDetails.weight);
  const caloriesBurntPerMinute = 5; // Sample value, actual calculation may vary
  return durationInMinutes * caloriesBurntPerMinute * weightInKg;
};
