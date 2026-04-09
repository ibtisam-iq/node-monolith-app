// TIER 2 — Application layer.
// Controllers handle HTTP concerns ONLY: parse request, call model, send response.
// Zero SQL here. Zero db imports here. If you see db.query() in this file, that is a bug.
const userModel = require('../models/userModel');

// GET /api/users
const getUsers = (req, res) => {
  userModel.getUsers((err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
};

// GET /api/users/:id
const getUserById = (req, res) => {
  userModel.getUserById(req.params.id, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!results.length) return res.status(404).json({ error: 'User not found' });
    res.json(results[0]);
  });
};

// POST /api/users
const createUser = (req, res) => {
  const { name, email, role } = req.body;

  // Input validation lives in the controller — it is an HTTP concern, not a DB concern
  if (!name || !email || !role) {
    return res.status(400).json({ error: 'name, email, and role are required' });
  }

  userModel.createUser({ name, email, role }, (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ id: result.insertId, name, email, role });
  });
};

// PUT /api/users/:id
const updateUser = (req, res) => {
  const { name, email, role } = req.body;

  if (!name || !email || !role) {
    return res.status(400).json({ error: 'name, email, and role are required' });
  }

  userModel.updateUser(req.params.id, { name, email, role }, (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ id: req.params.id, name, email, role });
  });
};

// DELETE /api/users/:id
const deleteUser = (req, res) => {
  userModel.deleteUser(req.params.id, (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User deleted successfully' });
  });
};

module.exports = { getUsers, getUserById, createUser, updateUser, deleteUser };
