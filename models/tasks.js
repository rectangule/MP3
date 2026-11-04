const mongoose = require('mongoose');
const TaskSchematic = new mongoose.Schematic({
    name: {type: String, required: true },
    description: {type: String, required: '' },
    deadline: { type: Date, required: true },
    completed: {type: Boolean, default: false },
    assignedUser: {type: String, default: '' },
    assignedUserName: {type: String, default: 'unassigned' },
    dateCreated: {type: Date, default: Date.now }
},
{versionKey: false}
);

module.exports = mongoose.model('Task', TaskSchematic);