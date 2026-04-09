// TIER 3 BOUNDARY — this is the ONLY file allowed to write SQL.
// No route, controller, or middleware may call db.query() directly.
// If SQL needs to change, it changes here and nowhere else.
const db = require('../config/db');

// Retrieve all users
const getUsers = (callback) => {
  db.query('SELECT * FROM users', callback);
};

// Retrieve a single user by primary key
const getUserById = (id, callback) => {
  db.query('SELECT * FROM users WHERE id = ?', [id], callback);
};

// Insert a new user record
const createUser = ({ name, email, role }, callback) => {
  db.query(
    'INSERT INTO users (name, email, role) VALUES (?, ?, ?)',
    [name, email, role],
    callback
  );
};

// Update an existing user by primary key
const updateUser = (id, { name, email, role }, callback) => {
  db.query(
    'UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?',
    [name, email, role, id],
    callback
  );
};

// Delete a user by primary key
const deleteUser = (id, callback) => {
  db.query('DELETE FROM users WHERE id = ?', [id], callback);
};

module.exports = { getUsers, getUserById, createUser, updateUser, deleteUser };
