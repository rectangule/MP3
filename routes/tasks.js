var Task = require('../models/task');
var User = require('../models/user');

function isId(v) { return typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v); }
function fail(status, message) { var error = new Error(message); error.status = status; return error; }

function parseJson(raw, name) {
    if (raw === undefined) return undefined;
    try {
        var v = JSON.parse(raw);
        if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error();
        return v;
    } catch (e) { throw fail(400, 'The "' + name + '" parameter must be a valid JSON object.'); }
}

function parseNum(raw, name) {
    if (raw === undefined) return undefined;
    var num = Number(raw);
    if (raw === '' || !Number.isInteger(num) || num < 0)
        throw fail(400, 'The "' + name + '" parameter must be a non-negative integer.');
    return num;
}

function handleError(res, err) {
    if (err.status) return res.status(err.status).json({ message: err.message, data: {} });
    console.error(err);
    return res.status(500).json({ message: 'Something went wrong on the server.', data: {} });
}

async function parseTask(b) {
    b = b || {};
    if (typeof b.name !== 'string' || !b.name.trim()) throw fail(400, 'A task must have a name.');

    var deadline;
    if (typeof b.deadline === 'number') deadline = new Date(b.deadline);
    else if (typeof b.deadline === 'string' && b.deadline.trim())
        deadline = new Date(/^\d+$/.test(b.deadline.trim()) ? Number(b.deadline) : b.deadline);
    if (!deadline || isNaN(deadline.getTime())) throw fail(400, 'A task must have a valid deadline.');

    if (b.description !== undefined && b.description !== null && typeof b.description !== 'string')
        throw fail(400, 'description must be text.');

    var completed = false;
    if (b.completed !== undefined && b.completed !== null) {
        if (b.completed === true || b.completed === 'true') completed = true;
        else if (b.completed === false || b.completed === 'false') completed = false;
        else throw fail(400, 'completed must be true or false.');
    }

    var assignedUser = (b.assignedUser === undefined || b.assignedUser === null) ? '' : b.assignedUser;
    if (typeof assignedUser !== 'string') throw fail(400, 'assignedUser must be a user id.');
    if (assignedUser && !isId(assignedUser)) throw fail(400, 'assignedUser is not a valid user id.');

    var given = b.assignedUserName;
    if (given !== undefined && given !== null && typeof given !== 'string')
        throw fail(400, 'assignedUserName must be text.');
    if (given === null) given = undefined;

    var assignedUserName = 'unassigned';
    if (!assignedUser) {
        if (given !== undefined && given !== '' && given !== 'unassigned')
            throw fail(400, 'assignedUserName does not match the assigned user.');
    } else {
        var user = await User.findById(assignedUser);
        if (!user) throw fail(404, 'The assigned user does not exist.');
        if (given !== undefined && given !== user.name)
            throw fail(400, 'assignedUserName does not match the assigned user.');
        assignedUserName = user.name;
    }

    return {
        name: b.name,
        description: b.description || '',
        deadline: deadline,
        completed: completed,
        assignedUser: assignedUser,
        assignedUserName: assignedUserName
    };
}

async function syncUsers(taskId, oldAssignedUser, t) {
    var id = String(taskId);
    if (oldAssignedUser && oldAssignedUser !== t.assignedUser)
        await User.updateOne({ _id: oldAssignedUser }, { $pull: { pendingTasks: id } });
    if (t.assignedUser)
        await User.updateOne(
            { _id: t.assignedUser },
            t.completed ? { $pull: { pendingTasks: id } } : { $addToSet: { pendingTasks: id } }
        );
}

module.exports = function (router) {
    var tasksRoute = router.route('/tasks');
    var tasksIdRoute = router.route('/tasks/:id');

    tasksRoute.get(async function (req, res) {
        try {
            var q = req.query;
            var where = parseJson(q.where, 'where') || {};
            var sort = parseJson(q.sort, 'sort');
            var select = parseJson(q.select, 'select');
            var skip = parseNum(q.skip, 'skip');
            var limit = parseNum(q.limit, 'limit');
            if (limit === undefined) limit = 100;

            if (q.count === 'true') {
                var total = await Task.countDocuments(where);
                return res.status(200).json({ message: 'OK', data: total });
            }
            var query = Task.find(where);
            if (sort) query = query.sort(sort);
            if (select) query = query.select(select);
            if (skip) query = query.skip(skip);
            if (limit) query = query.limit(limit);
            res.status(200).json({ message: 'OK', data: await query.exec() });
        } catch (error) {
            if (error.name === 'CastError' || error.name === 'MongoServerError')
                return res.status(400).json({ message: 'One of the query parameters is not valid.', data: {} });
            handleError(res, error);
        }
    });

    tasksRoute.post(async function (req, res) {
        try {
            var data = await parseTask(req.body);
            var task = await new Task(data).save();
            await syncUsers(task._id, '', data);
            res.status(201).json({ message: 'Task created.', data: task });
        } catch (error) { handleError(res, error); }
    });

    tasksIdRoute.get(async function (req, res) {
        try {
            if (!isId(req.params.id)) throw fail(404, 'That task does not exist.');
            var select = parseJson(req.query.select, 'select');
            var query = Task.findById(req.params.id);
            if (select) query = query.select(select);
            var task = await query.exec();
            if (!task) throw fail(404, 'That task does not exist.');
            res.status(200).json({ message: 'OK', data: task });
        } catch (error) {
            if (error.name === 'MongoServerError')
                return res.status(400).json({ message: 'The "select" parameter is not valid.', data: {} });
            handleError(res, error);
        }
    });

    tasksIdRoute.put(async function (req, res) {
        try {
            var task = isId(req.params.id) ? await Task.findById(req.params.id) : null;
            if (!task) throw fail(404, 'That task does not exist.');
            var data = await parseTask(req.body);
            var oldAssigned = task.assignedUser;
            task.set(data);
            await task.save();
            await syncUsers(task._id, oldAssigned, data);
            res.status(200).json({ message: 'Task updated.', data: task });
        } catch (error) { handleError(res, error); }
    });

    tasksIdRoute.delete(async function (req, res) {
        try {
            var task = isId(req.params.id) ? await Task.findById(req.params.id) : null;
            if (!task) throw fail(404, 'That task does not exist.');
            if (task.assignedUser)
                await User.updateOne({ _id: task.assignedUser }, { $pull: { pendingTasks: String(task._id) } });
            await task.deleteOne();
            res.status(200).json({ message: 'Task deleted.', data: {} });
        } catch (error) { handleError(res, error); }
    });

    return router;
};