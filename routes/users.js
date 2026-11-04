var User = require('../models/user');
var Task = require('../models/task');

function isId(v) { return typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v); }
function fail(status, message) { var error = new Error(message); error.status = status; return error; }

function parseJson(raw, name) {
    if (raw === undefined) return undefined;
    try {
        var v = JSON.parse(raw);
        if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error();
        return v;
    } catch (error) {
        var error = new Error('The "' + name + '" parameter must be a valid JSON object.');
        error.status = 400;
        throw error;
    }
}

function parseNum(raw, name) {
    if (raw === undefined) return undefined;
    var n = Number(raw);
    if (raw === '' || !Number.isInteger(n) || n < 0) {
        var error = new Error('The "' + name + '" parameter must be a non-negative integer.');
        error.status = 400;
        throw error;
    }
    return n;
}

function handleError(res, error) {
    if (error.status) return res.status(error.status).json({ message: error.message, data: {} });
    if (error.code === 11000)
        return res.status(400).json({ message: 'A user with that email already exists.', data: {} });
    console.error(error);
    return res.status(500).json({ message: 'Something went wrong on the server.', data: {} });

}

function normList(v) {
    if (v === undefined || v === null || v === '') return [];
    if (typeof v === 'string') {
        if (v.trim().startsWith('[')) {
            try { v = JSON.parse(v); } catch (error) { throw fail(400, 'pendingTasks must be a list of task ids.'); }
        } else v = [v];
    }
    if (!Array.isArray(v)) throw fail(400, 'pendingTasks must be a list of task ids.');
    for (var i = 0; i < v.length; i++)
        if (!isId(v[i])) throw fail(400, 'pendingTasks contains an invalid task id.');
    return Array.from(new Set(v));
}

async function parseUser(b, selfId) {
    b = b || {};
    if (typeof b.name !== 'string' || !b.name.trim()) throw fail(400, 'A user must have a name.');
    if (typeof b.email !== 'string' || !b.email.trim()) throw fail(400, 'A user must have an email.');
    var ids = normList(b.pendingTasks);

    var filter = { email: b.email };
    if (selfId) filter._id = { $ne: selfId };
    if (await User.findOne(filter)) throw fail(400, 'A user with that email already exists.');

    var tasks = [];
    if (ids.length) {
        tasks = await Task.find({ _id: { $in: ids } });
        if (tasks.some(function (t) { return t.completed; }))
            throw fail(400, 'pendingTasks cannot contain a completed task.');
        if (tasks.length < ids.length) throw fail(404, 'One of the pending tasks does not exist.');
    }
    return { name: b.name, email: b.email, ids: ids, tasks: tasks };
}

async function syncTasks(userId, name, oldIds, newIds, tasks) {
    var uid = String(userId);
    var removed = oldIds.filter(function (id) { return !newIds.includes(id); });
    if (removed.length)
        await Task.updateMany({ _id: { $in: removed }, assignedUser: uid },
            { assignedUser: '', assignedUserName: 'unassigned' });
    for (var i = 0; i < tasks.length; i++) {
        var t = tasks[i];
        if (t.assignedUser && t.assignedUser !== uid)
            await User.updateOne({ _id: t.assignedUser }, { $pull: { pendingTasks: String(t._id) } });
    }
    if (newIds.length)
        await Task.updateMany({ _id: { $in: newIds } }, { assignedUser: uid, assignedUserName: name });
    await Task.updateMany({ assignedUser: uid }, { assignedUserName: name });
}

module.exports = function (router) {
    const usersRoute = router.route("/users");
    const usersIdRoute = router.route("/users/:id");

    usersRoute.get(async function (req, res) {
        try {
            var q = req.query;
            var where = parseJson(q.where, 'where') || {};
            var sort = parseJson(q.sort, 'sort');
            var select = parseJson(q.select, 'select');
            var skip = parseNum(q.skip, 'skip');
            var limit = parseNum(q.limit, 'limit');

            if (q.count === 'true') {
                var total = await User.countDocuments(where);
                return res.status(200).json({ message: 'OK', data: total });
            }

            var query = User.find(where);
            if (sort) query = query.sort(sort);
            if (select) query = query.select(select);
            if (skip) query = query.skip(skip);
            if (limit) query = query.limit(limit);
            var users = await query.exec();
            res.status(200).json({ message: 'OK', data: users });
        } catch (error) {
            if (error.status === 400 || error.name === 'CastError' || error.name === 'MongoServerError') {
                return res.status(400).json({ message: 'Bad Request. something wrong', data: {} });
            }
            res.status(500).json({ message: 'Error retrieving users', data: {} });
        }
    });

    /*usersRoute.post(async function (req, res) {
        var b = req.body || {};
        if (typeof b.name !== 'string' || !b.name.trim()) {
            return res.status(400).json({ message: 'Name is required and must be a non-empty string' });
        }
        if (typeof b.email !== 'string' || !b.email.trim()) {
            return res.status(400).json({ message: 'Email is required and must be a non-empty string' });
        }
        try {
            if (await User.findOne({ email: b.email })) {
                return res.status(400).json({ message: 'Email already exists', data: {} });
            }
            var user = await new User({ name: b.name, email: b.email }).save();
            res.status(201).json({ message: 'User created successfully', data: user });
        } catch (error) {
            res.status(500).json({ message: 'Error creating user', error: error.message });
        }
    });*/
    usersRoute.post(async function (req, res) {
        try {
            var p = await parseUser(req.body, null);
            var user = await new User({ name: p.name, email: p.email, pendingTasks: p.ids }).save();
            await syncTasks(user._id, p.name, [], p.ids, p.tasks);
            res.status(201).json({ message: 'User created.', data: user });
        } catch (error) { handleError(res, error); }
    });
    /*usersRoute.post(...);
    usersRoute.get(...);
    usersRoute.put(...);
    usersRoute.delete(...);

    usersIdRoute.post(...);
    usersIdRoute.get(...);
    usersIdRoute.put(...);
    usersIdRoute.delete(...);*/
     /*usersIdRoute.get(async function (req, res) {
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id))
            return res.status(404).json({ message: 'That user does not exist.', data: {} });
        try {
            var select = parseJson(req.query.select, 'select');
            var query = User.findById(req.params.id);
            if (select) query = query.select(select);
            var user = await query.exec();
            if (!user)
                return res.status(404).json({ message: 'That user does not exist.', data: {} });
            res.status(200).json({ message: 'OK', data: user });
        } catch (error) {
            if (error.status === 400 || error.name === 'MongoServerError')
                return res.status(400).json({ message: error.status ? error.message : 'The "select" parameter is not valid.', data: {} });
            res.status(500).json({ message: 'Something went wrong on the server.', data: {} });
        }
    });*/
     usersIdRoute.get(async function (req, res) {
        try {
            if (!isId(req.params.id)) throw fail(404, 'That user does not exist.');
            var select = parseJson(req.query.select, 'select');
            var query = User.findById(req.params.id);
            if (select) query = query.select(select);
            var user = await query.exec();
            if (!user) throw fail(404, 'That user does not exist.');
            res.status(200).json({ message: 'OK', data: user });
        } catch (error) {
            if (error.name === 'MongoServerError')
                return res.status(400).json({ message: 'The "select" parameter is not valid.', data: {} });
            handleError(res, error);
        }
    });
     /*usersIdRoute.put(async function (req, res) {
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id))
            return res.status(404).json({ message: 'That user does not exist.', data: {} });
        var b = req.body || {};
        try {
            var user = await User.findById(req.params.id);
            if (!user)
                return res.status(404).json({ message: 'That user does not exist.', data: {} });
            if (typeof b.name !== 'string' || !b.name.trim())
                return res.status(400).json({ message: 'A user must have a name.', data: {} });
            if (typeof b.email !== 'string' || !b.email.trim())
                return res.status(400).json({ message: 'A user must have an email.', data: {} });
            if (await User.findOne({ email: b.email, _id: { $ne: user._id } }))
                return res.status(400).json({ message: 'A user with that email already exists.', data: {} });
            user.name = b.name;
            user.email = b.email;
            await user.save();
            res.status(200).json({ message: 'User updated.', data: user });
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: 'Error updating user', data: {} });
        }
    });*/
    usersIdRoute.put(async function (req, res) {
        try {
            var user = isId(req.params.id) ? await User.findById(req.params.id) : null;
            if (!user) throw fail(404, 'That user does not exist.');
            var p = await parseUser(req.body, user._id);
            var oldIds = user.pendingTasks.slice();
            user.set({ name: p.name, email: p.email, pendingTasks: p.ids });
            await user.save();
            await syncTasks(user._id, p.name, oldIds, p.ids, p.tasks);
            res.status(200).json({ message: 'User updated.', data: user });
        } catch (error) { handleError(res, error); }
    });

    /* usersIdRoute.delete(async function (req, res) {
        if (!/^[0-9a-fA-F]{24}$/.test(req.params.id))
            return res.status(404).json({ message: 'That user does not exist.', data: {} });
        try {
            var user = await User.findById(req.params.id);
            if (!user)
                return res.status(404).json({ message: 'That user does not exist.', data: {} });
            await user.deleteOne();
            res.status(200).json({ message: 'User deleted.', data: {} });
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: 'Error deleting user', data: {} });
        }
    });*/

    usersIdRoute.delete(async function (req, res) {
        try {
            var user = isId(req.params.id) ? await User.findById(req.params.id) : null;
            if (!user) throw fail(404, 'That user does not exist.');
            await Task.updateMany({ assignedUser: String(user._id) },
                { assignedUser: '', assignedUserName: 'unassigned' });
            await user.deleteOne();
            res.status(200).json({ message: 'User deleted.', data: {} });
        } catch (error) { handleError(res, error); }
    });
    return router;
}