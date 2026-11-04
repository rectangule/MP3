// Load required packages
var mongoose = require('mongoose');

// Define our user schema
var UserSchema = new mongoose.Schema({
    name: { type: String, required: [true, "name is required"], unique: true },
    email: { type: String, required: [true, "email is required"], unique: true },
    pendingTasks: { type: [String], default: [] },
    dateCreated: { type: Date, default: Date.now }
    },
{ versionKey: false }
);

// Export the Mongoose model
module.exports = mongoose.model('User', UserSchema);
