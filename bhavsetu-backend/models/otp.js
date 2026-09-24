const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
    email: { type: String, required: true },
    otp: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 300 } // Yeh 5 minute baad database se apne aap delete ho jayega
});

module.exports = mongoose.model('Otp', otpSchema);