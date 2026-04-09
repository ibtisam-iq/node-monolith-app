// TIER 2 — Routing layer.
// Routes map HTTP verbs + paths to controller methods. Nothing else.
// No SQL, no db imports, no business logic. Just wiring.
const express    = require('express');
const router     = express.Router();
const controller = require('../controllers/userController');

// This router is mounted at /api/users in app.js,
// so paths here are relative (/ not /api/users).
router.get('/',    controller.getUsers);     // GET    /api/users
router.get('/:id', controller.getUserById);  // GET    /api/users/:id
router.post('/',   controller.createUser);   // POST   /api/users
router.put('/:id', controller.updateUser);   // PUT    /api/users/:id
router.delete('/:id', controller.deleteUser);// DELETE /api/users/:id

module.exports = router;
