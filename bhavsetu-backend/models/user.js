const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    phone: { type: String, default: "" },
    name: { type: String, default: "" },
    state: { type: String, default: "" },
    district: { type: String, default: "" },
    village: { type: String, default: "" },
    verified: { type: Boolean, default: false }
});

module.exports = mongoose.model('User', userSchema);