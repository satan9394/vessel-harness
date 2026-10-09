// Static diagnostic fixture only. CLI audit/doctor must never execute this file.
module.exports = { observe() { return process.env.API_KEY; } };
