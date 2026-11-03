module.exports = function (router) {
    const mongoose = require('mongoose');
    const User = require("../models/user.js")
    const Task = require("../models/task.js")

    const usersRoute = router.route("/users");
    const usersIdRoute = router.route("/users/:id");

    usersRoute.get(async function (req, res) {
        // Create a query to find something in the User collection
        const query = User.find();

        // Add query conditions from URL
        try {
            if (req.query["where"]) { query.where(JSON.parse(req.query.where)); }
            if (req.query["sort"]) { query.sort(JSON.parse(req.query.sort)); }
            if (req.query["select"]) { query.select(JSON.parse(req.query.select)); }
            if (req.query["skip"]) { query.skip(Number(req.query.skip)); }
            if (req.query["limit"]) { query.limit(Number(req.query.limit)); }
            if (req.query["count"] == "true") {
                const count = await query.countDocuments();
                return res.status(200).json({ message: "Count successfully retrieved", data: count });
            }
        } catch (_) {
            return res.status(400).json({ message: "Error with parsing url parameters/filters", data: [] });
        }

        // Execute the final query and handle any associated errors
        try {
            const result = await query.exec();
            return res.status(200).json({ message: "Data successfully retrieved", data: result });
        } catch (_) {
            return res.status(500).json({ message: "Error with the server/database", data: [] });
        }
    });

    usersRoute.post(async function (req, res) {
        // Validate the fields for the new user
        const newUser = new User(req.body);
        try {
            await newUser.validate();
        } catch (_) {
            return res.status(400).json({ message: "New user is incorrectly formatted", data: {} });
        }

        // Ensure all of the task Ids in pendingTasks are valid
        const pendingTasks = req.body.pendingTasks;
        for (let taskId of pendingTasks) {
            if (!mongoose.isValidObjectId(taskId)) {
                return res.status(400).json({ message: "Invalid task Id in pendingTasks", data: {} });
            }
        }

        // Ensure that all of the tasks in pendingTasks exist
        let existingTasks = await Task.find({ _id: { $in: pendingTasks } });
        if (existingTasks.length !== pendingTasks.length) {
            return res.status(404).json({ message: "User's list of pending tasks include tasks that do not exist", data: {} });
        }

        // Check if any task in pendingTasks is complete
        for (let task of existingTasks) {
            if (task.completed) {
                return res.status(400).json({ message: "Cannot include completed tasks in user's list of pending tasks", data: {} });
            }
        }

        // Loop post attempt in case it fails with a retriable error
        const maxAttempts = 5;
        for (let i = 0; i < maxAttempts; i++) {
            try {
                const newUser = new User(req.body);
                // save already uses schema validation
                const savedUser = await newUser.save();
                // Loop through each task in pending tasks and make sure they are assigned to the new user
                await Task.updateMany(
                    { _id: { $in: pendingTasks } },
                    { assignedUser: savedUser._id.toString(), assignedUserName: savedUser.name }
                );
                // Return successful response
                return res.status(201).json({ message: "User successfully created and saved", data: savedUser });
            } catch (err) {
                // If the error is retriable, wait and loop again
                if (err.hasErrorLabel && err.hasErrorLabel("TransientTransactionError")) {
                    await new Promise((x) => setTimeout(x, (i+1) * 100));
                    continue;
                } else if (err.code === 11000) {
                    return res.status(400).json({ message: "Email already in use", data: {} });
                } else {
                    // Server side error
                    return res.status(500).json({ message: "Error with the server/database", data: {} });
                }
            }
        }
    });

    usersIdRoute.get(async function (req, res) {
        // Check to ensure the object id is valid
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(404).json({ message: "Invalid User Id", data: {} });
        }
        // Create a query to find a User by their id
        const query = User.findById(req.params.id);
        // Add query condition (the only one that applies is select)
        try {
            if (req.query["select"]) { query.select(JSON.parse(req.query.select)); }
        } catch (_) {
            return res.status(400).json({ message: "Error with parsing url parameters/filters", data: {} });
        }

        // Execute query and handle errors
        try {
            const result = await query.exec();
            // If result is null, the user was not found
            if (!result) {
                return res.status(404).json({ message: "User not found", data: {} });
            } else {
                return res.status(200).json({ message: "User successfully retrieved", data: result });
            }
        } catch (_) {
            return res.status(500).json({ message: "Error with the server/database", data: {} });
        }
    });

    usersIdRoute.put(async function (req, res) {
        // Check to ensure the object id is valid
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(404).json({ message: "Invalid User Id", data: {} });
        }

        // Validate the fields for the new user
        const newUser = new User(req.body);
        try {
            await newUser.validate();
        } catch (_) {
            return res.status(400).json({ message: "New user is incorrectly formatted or email is already in use", data: {} });
        }

        // Ensure all of the task Ids in pendingTasks are valid
        const pendingTasks = req.body.pendingTasks;
        for (let taskId of pendingTasks) {
            if (!mongoose.isValidObjectId(taskId)) {
                return res.status(400).json({ message: "Invalid task Id in pendingTasks", data: {} });
            }
        }

        // Ensure that all of the tasks in pendingTasks exist
        let existingTasks = await Task.find({ _id: { $in: pendingTasks } });
        if (existingTasks.length !== pendingTasks.length) {
            return res.status(404).json({ message: "User's list of pending tasks include tasks that do not exist", data: {} });
        }

        // Check if any task in pendingTasks is complete
        for (let task of existingTasks) {
            if (task.completed) {
                return res.status(400).json({ message: "Cannot include completed tasks in user's list of pending tasks", data: {} });
            }
        }

        // Attempt to find and update user
        try {
            const oldUser = await User.findById(req.params.id).exec();
            const updatedUser = await User.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }).exec();

            // If updated user is null, it means the existing user could not be found
            if (!updatedUser || !oldUser) {
                return res.status(404).json({ message: "User not found", data: {} });
            } else {
                // Unassign all tasks from the old user
                await Task.updateMany(
                    { _id: { $in: oldUser.pendingTasks } },
                    { assignedUser: "", assignedUserName: "unassigned" }
                );
                // Loop through the updated user's tasks and remove any that are assigned to another user
                // from that specific user's pending tasks list
                for (let taskId of updatedUser.pendingTasks) {
                    const currentTask = await Task.findById(taskId);
                    if (currentTask.assignedUser !== updatedUser._id.toString() && currentTask.assignedUser !== "") {
                        await User.findByIdAndUpdate(currentTask.assignedUser, {
                            $pull: { pendingTasks: taskId }
                        });
                    }
                }
                // Assign tasks to the updated user
                await Task.updateMany(
                    { _id: { $in: updatedUser.pendingTasks } },
                    { assignedUser: updatedUser._id.toString(), assignedUserName: updatedUser.name }
                );
                return res.status(200).json({ message: "Successfully updated user", data: updatedUser });
            }
        } catch (err) {
            if (err.code === 11000) { return res.status(400).json({ message: "Email already in use", data: {} }); }
            return res.status(500).json({ message: "Error with the server/database", data: {} });
        }
    });

    usersIdRoute.delete(async function (req, res) {
        // Check to ensure the object id is valid
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(404).json({ message: "Invalid User Id", data: {} });
        }

        // Attempt to find and delete user
        try {
            const deletedUser = await User.findByIdAndDelete(req.params.id).exec();
            // If null, user couldn't be found
            if (!deletedUser) {
                return res.status(404).json({ message: "User not found", data: {} });
            } else {
                // Reassign all of user's pending tasks' assignedUser and assignedUserName to "" and "unassigned" respectively
                let oldPendingTasks = deletedUser.pendingTasks;
                await Task.updateMany(
                    { _id: { $in: oldPendingTasks } },
                    { assignedUser: "", assignedUserName: "unassigned" }
                );
                return res.status(200).json({ message: "User deleted successfully", data: deletedUser });
            }
        } catch (_) {
            return res.status(500).json({ message: "Error with the server/database", data: {} });
        }
    });

    return router;
}