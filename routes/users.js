var User = require('../models/user');
function parseJson(raw, name) {
    if (raw === undefined) return undefined;
    try {
        var v = JSON.parse(raw);
        if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error();
        return v;
    } catch (e) {
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

    usersRoute.post(async function (req, res) {
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
    });
    /*usersRoute.post(...);
    usersRoute.get(...);
    usersRoute.put(...);
    usersRoute.delete(...);

    usersIdRoute.post(...);
    usersIdRoute.get(...);
    usersIdRoute.put(...);
    usersIdRoute.delete(...);*/
     usersIdRoute.get(async function (req, res) {
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
        } catch (err) {
            if (err.status === 400 || err.name === 'MongoServerError')
                return res.status(400).json({ message: err.status ? err.message : 'The "select" parameter is not valid.', data: {} });
            res.status(500).json({ message: 'Something went wrong on the server.', data: {} });
        }
    });
     usersIdRoute.put(async function (req, res) {
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
    });
     usersIdRoute.delete(async function (req, res) {
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
    });
    return router;
}