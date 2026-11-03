module.exports = function (router) {
    const mongoose = require('mongoose');
    const User = require("../models/user.js")
    const Task = require("../models/task.js")

    const tasksRoute = router.route("/tasks");
    const tasksIdRoute = router.route("/tasks/:id");

    tasksRoute.get(async function (req, res) {
        // Create a query to find something in the Task collection
        const query = Task.find();

        // Add query conditions from URL
        try {
            if (req.query["where"]) { query.where(JSON.parse(req.query.where)); }
            if (req.query["sort"]) { query.sort(JSON.parse(req.query.sort)); }
            if (req.query["select"]) { query.select(JSON.parse(req.query.select)); }
            if (req.query["skip"]) { query.skip(Number(req.query.skip)); }
            if (req.query["limit"]) { 
                query.limit(Number(req.query.limit)); 
            } else {
                query.limit(100);
            }
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

    tasksRoute.post(async function (req, res) {
        let setUserName = "";
        // Validate the fields for the new task
        const newTask = new Task(req.body);
        try {
            await newTask.validate();
        } catch (_) {
            return res.status(400).json({ message: "New task is incorrectly formatted", data: {} });
        }

        // Ensure the task's assigned user is a valid Object Id (or the empty string)
        if (!mongoose.isValidObjectId(newTask.assignedUser) && newTask.assignedUser !== "") {
            return res.status(400).json({ message: "Invalid user id for task's assigned user", data: {} });
        }

        // Ensure that the assigned user exists and the assigned user name matches the user's name
        if (newTask.assignedUser !== "") {
            let assignedUser = await User.findById(newTask.assignedUser).exec();

            if (!assignedUser) {
                return res.status(404).json({ message: "Task's referenced user does not exist", data: {} }); 
            }
            if (newTask.assignedUserName === "unassigned") {
                setUserName = assignedUser.name;
                newTask.assignedUserName = setUserName;
            }
            if (assignedUser.name !== newTask.assignedUserName) {
                return res.status(400).json({ message: "Task's assigned user id does not match assigned user name", data: {} });
            }
        } else {
            // When the assigned user is left blank, the name must be set to unassigned
            if (newTask.assignedUserName !== "unassigned") {
                return res.status(400).json({ message: "Task's assigned user id does not match assigned user name", data: {} });
            }
        }

        // Loop post attempt in case it fails with a retriable error
        const maxAttempts = 5;
        for (let i = 0; i < maxAttempts; i++) {
            try {
                const newTask = new Task(req.body);
                if (setUserName !== "") {
                    newTask.assignedUserName = setUserName;
                }
                // save already uses schema validation
                const savedTask = await newTask.save();
                // If task has an assigned user and is not complete, add it to that user's pendingTasks
                if (savedTask.assignedUser !== "" && !savedTask.completed) {
                    await User.findByIdAndUpdate(savedTask.assignedUser, {
                        $addToSet: { pendingTasks: savedTask._id }
                    });
                }
                // Return successful response
                return res.status(201).json({ message: "Task successfully created and saved", data: savedTask });
            } catch (err) {
                // If the error is retriable, wait and loop again
                if (err.hasErrorLabel && err.hasErrorLabel("TransientTransactionError")) {
                    await new Promise((x) => setTimeout(x, (i+1) * 100));
                    continue;
                } else if (err.code === 11000) {
                    return res.status(400).json({ message: "This shouldn't be possible", data: {} });
                } else {
                    // Server side error
                    return res.status(500).json({ message: "Error with the server/database", data: {} });
                }
            }
        }
    });

    tasksIdRoute.get(async function (req, res) {
        // Check to ensure the object id is valid
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(404).json({ message: "Invalid Task Id", data: {} });
        }
        // Create a query to find a Task by their id
        const query = Task.findById(req.params.id);
        // Add query condition (the only one that applies is select)
        try {
            if (req.query["select"]) { query.select(JSON.parse(req.query.select)); }
        } catch (_) {
            return res.status(400).json({ message: "Error with parsing url parameters/filters", data: {} });
        }

        // Execute query and handle errors
        try {
            const result = await query.exec();
            // If result is null, the task was not found
            if (!result) {
                return res.status(404).json({ message: "Task not found", data: {} });
            } else {
                return res.status(200).json({ message: "Task successfully retrieved", data: result });
            }
        } catch (_) {
            return res.status(500).json({ message: "Error with the server/database", data: {} });
        }
    });

    tasksIdRoute.put(async function (req, res) {
        // Check to ensure the object id is valid
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(404).json({ message: "Invalid Task Id", data: {} });
        }

        // Validate the fields for the new task
        const newTask = new Task(req.body);
        try {
            await newTask.validate();
        } catch (_) {
            return res.status(400).json({ message: "New task is incorrectly formatted", data: {} });
        }

        // Ensure the task's assigned user is a valid Object Id (or the empty string)
        if (!mongoose.isValidObjectId(newTask.assignedUser) && newTask.assignedUser !== "") {
            return res.status(400).json({ message: "Invalid user id for task's assigned user", data: {} });
        }

        // Ensure that the assigned user exists and the assigned user name matches the user's name
        if (newTask.assignedUser !== "") {
            let assignedUser = await User.findById(newTask.assignedUser).exec();

            if (!assignedUser) {
                return res.status(404).json({ message: "Task's referenced user does not exist", data: {} }); 
            }
            if (newTask.assignedUserName === "unassigned") {
                newTask.assignedUserName = assignedUser.name;
            }
            if (assignedUser.name !== newTask.assignedUserName) {
                return res.status(400).json({ message: "Task's assigned user id does not match assigned user name", data: {} });
            }
        } else {
            // When the assigned user is left blank, the name must be set to unassigned
            if (newTask.assignedUserName !== "unassigned") {
                return res.status(400).json({ message: "Task's assigned user id does not match assigned user name", data: {} });
            }
        }

        // Attempt to find and update task
        try {
            const oldTask = await Task.findById(req.params.id).exec();
            const updatedTask = await Task.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }).exec();

            // If updated task is null, it means the existing task could not be found
            if (!updatedTask || !oldTask) {
                return res.status(404).json({ message: "Task not found", data: {} });
            } else {
                // If the old task had an assigned user and was not complete, remove it from that user's pendingTasks
                if (oldTask.assignedUser !== "" && !oldTask.completed) {
                    await User.findByIdAndUpdate(oldTask.assignedUser, {
                        $pull: { pendingTasks: oldTask._id }
                    });
                }
                // If task has an assigned user and is not complete, add it to that user's pendingTasks
                if (updatedTask.assignedUser !== "" && !updatedTask.completed) {
                    await User.findByIdAndUpdate(updatedTask.assignedUser, {
                        $addToSet: { pendingTasks: updatedTask._id }
                    });
                }
                return res.status(200).json({ message: "Successfully updated task", data: updatedTask });
            }
        } catch (err) {
            if (err.code === 11000) { return res.status(400).json({ message: "Seriously how did you do this", data: {} }); }
            return res.status(500).json({ message: "Error with the server/database", data: {} });
        }
    });

    tasksIdRoute.delete(async function (req, res) {
        // Check to ensure the object id is valid
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(404).json({ message: "Invalid Task Id", data: {} });
        }

        // Attempt to find and delete task
        try {
            const deletedTask = await Task.findByIdAndDelete(req.params.id).exec();
            // If null, task couldn't be found
            if (!deletedTask) {
                return res.status(404).json({ message: "Task not found", data: {} });
            } else {
                // If the task wasn't already completed and had an assigned user, remove it from assigned user's pendingTasks
                if (deletedTask.assignedUser !== "" && !deletedTask.completed) {
                    await User.findByIdAndUpdate(deletedTask.assignedUser, {
                        $pull: { pendingTasks: deletedTask._id }
                    });
                }
                return res.status(204).send();
            }
        } catch (_) {
            return res.status(500).json({ message: "Error with the server/database", data: {} });
        }
    });

    return router;
}