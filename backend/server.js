const express = require('express');
const db = require('./config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const authenticateToken = require('./middleware/auth');
const multter = require('multer');
const path = require('path')
const storage = multter.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './uploads/original');
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});
const upload = multter({ storage: storage });
require('dotenv').config();
const app = express()
const port = 3000
app.use(express.json());
app.get('/', (req, res) => {
  res.send('Hello World!')
})
app.post('/freelancer/signup', async (req, res) => {
  const { userName, name, emailId, phone, password } = req.body;
  if (!userName || !name || !emailId || !phone || !password) {
    return res.status(400).json({ error: 'Missing credentials' });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const sql = `INSERT INTO freeLancer (userName,name,emailId,phone,password) VALUES (?,?,?,?,?)`;
    db.query(sql, [userName, name, emailId, phone, hashedPassword], (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Signup failed', details: err.message });
      }
      res.status(201).json({ message: 'Freelancer created successfulle' });
    });
  } catch (err) {
    res.status(500).json({ error: 'Something went wrong' });
  }
});
app.post('/freelancer/login', (req, res) => {
  const { userName, password } = req.body;

  if (!userName || !password) {
    return res.status(400).json({ error: 'Missing username or password' });
  }
  const sql = `SELECT * FROM freeLancer WHERE userName = ?`;
  db.query(sql, [userName], async (err, results) => {
    if (err) return res.status(500).json({ error: 'Login failed' });

    if (results.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const freelancer = results[0];
    const match = await bcrypt.compare(password, freelancer.password);

    if (!match) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { userName: freelancer.userName },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ message: 'Login successful', token });
  });
})
app.post('/freelancer/products', authenticateToken, upload.single('file'), async (req, res) => {
  console.log('req.body')
  const {product_price, description} = req.body;
  
  const userName = req.freelancer.userName;

  if (!product_price || !description || !req.file) {
    return res.status(400).json({ error: 'Missing required fields or file' });
  }
console.log(req.file)
  const original_file_path = req.file.path;
  const sql = `INSERT INTO product (userName, product_price, description, original_file_path, watermark_file_path) VALUES (?, ?, ?, ?, ?)`;
  db.query(sql, [userName, product_price, description, original_file_path, 'PENDING'], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to create product' });
    }
    res.status(201).json({ message: 'Product created', prod_id: result.insertId });
  });
});
app.post('/freelancer/products/send', (req, res) => {

})

app.get('/transaction/:token/preview', (req, res) => {
  const token = req.params.token
})
app.post('/transaction/:token/pay', (req, res) => {

})
app.get('/transaction/:token/download', (req, res) => {

})
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
