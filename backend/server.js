const express = require('express');
const db = require('./config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const authenticateToken = require('./middleware/auth');
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const cors = require('cors');
const fs = require('fs');

// Self-contained ffmpeg/ffprobe binaries — no system install needed
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffprobePath = require('@ffprobe-installer/ffprobe').path;
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

// Ensure upload directories exist
const uploadDirs = ['uploads/original', 'uploads/preview'];
uploadDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './uploads/original');
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage: storage });

require('dotenv').config();
const app = express();
const port = 3000;

app.use(cors({
  origin: "https://trust-client-rose.vercel.app"
}));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Hello World!');
});

// ─── Auth routes ────────────────────────────────────────────
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
});

// ─── Watermarking functions ─────────────────────────────────
async function createWatermark(originalPath, outputPath) {
  const image = sharp(originalPath);
  const metadata = await image.metadata();
  const width = metadata.width;
  const height = metadata.height;

  const text = 'TrustClient PREVIEW';
  const fontSize = Math.floor(width / 15);

  let textElements = '';
  const rows = 4;
  const cols = 3;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = (width / cols) * col + (width / cols) / 2;
      const y = (height / rows) * row + (height / rows) / 2;
      textElements += `
        <text x="${x}" y="${y}" 
              font-size="${fontSize}" 
              fill="rgba(255,255,255,0.4)" 
              font-family="DejaVu Sans, sans-serif"
              text-anchor="middle" 
              transform="rotate(-30 ${x} ${y})">${text}</text>`;
    }
  }

  const watermarkSvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      ${textElements}
    </svg>
  `;

  await sharp(originalPath)
    .composite([{
      input: Buffer.from(watermarkSvg),
      gravity: 'center'
    }])
    .toFile(outputPath);
}

// Video watermark – uses Sharp to render text on a transparent PNG,
// then overlays it with FFmpeg. No system font required.
function createVideoWatermark(originalPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(originalPath, (err, metadata) => {
      if (err) return reject(err);

      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      if (!videoStream) return reject(new Error('No video stream found'));

      const width = videoStream.width;
      const height = videoStream.height;
      const text = 'TrustClient PREVIEW';
      const fontSize = Math.floor(width / 12);

      let textElements = '';
      const rows = 4;
      const cols = 3;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const x = (width / cols) * col + (width / cols) / 2;
          const y = (height / rows) * row + (height / rows) / 2;
          textElements += `
            <text x="${x}" y="${y}" 
                  font-size="${fontSize}" 
                  fill="rgba(255,255,255,0.4)" 
                  font-family="DejaVu Sans, sans-serif"
                  text-anchor="middle" 
                  transform="rotate(-30 ${x} ${y})">${text}</text>`;
        }
      }
      const watermarkSvg = `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <rect width="100%" height="100%" fill="transparent"/>
          ${textElements}
        </svg>
      `;

      const overlayPath = outputPath.replace('.mp4', '-overlay.png');

      sharp({
        create: {
          width: width,
          height: height,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
      })
      .composite([{ input: Buffer.from(watermarkSvg), gravity: 'center' }])
      .png()
      .toFile(overlayPath)
      .then(() => {
        ffmpeg(originalPath)
          .input(overlayPath)
          .complexFilter([
            { filter: 'overlay', options: { x: 0, y: 0 } }
          ])
          .outputOptions('-c:a copy')
          .on('end', () => {
            fs.unlink(overlayPath, () => {});
            resolve();
          })
          .on('error', (err) => {
            fs.unlink(overlayPath, () => {});
            reject(err);
          })
          .save(outputPath);
      })
      .catch(err => reject(err));
    });
  });
}

// ─── Product routes ─────────────────────────────────────────
app.get('/freelancer/products', authenticateToken, (req, res) => {
  const userName = req.freelancer.userName;
  const sql = `SELECT * FROM product WHERE userName = ?`;
  db.query(sql, [userName], (err, results) => {
    if (err) return res.status(500).json({ error: 'Server error' });
    res.json(results);
  });
});

app.post('/freelancer/products', authenticateToken, upload.single('file'), async (req, res) => {
  const { product_price, description } = req.body;
  const userName = req.freelancer.userName;
  const price = Number(product_price);

  if (isNaN(price) || price <= 0) {
    return res.status(400).json({ error: "Invalid price" });
  }

  if (!product_price || !description || !req.file) {
    return res.status(400).json({ error: 'Missing required fields or file' });
  }

  const original_file_path = req.file.path;
  const mimeType = req.file.mimetype;

  let watermark_file_path;

  try {
    if (mimeType.startsWith('image/')) {
      watermark_file_path = `uploads/preview/${Date.now()}-watermarked.png`;
      await createWatermark(original_file_path, watermark_file_path);
    } else if (mimeType.startsWith('video/')) {
      watermark_file_path = `uploads/preview/${Date.now()}-watermarked.mp4`;
      await createVideoWatermark(original_file_path, watermark_file_path);
    } else {
      return res.status(400).json({ error: 'Unsupported file type for now' });
    }
  } catch (err) {
    console.error('Watermark generation failed:', err);
    return res.status(500).json({ error: 'Failed to process file' });
  }

  const sql = `INSERT INTO product (userName, product_price, description, original_file_path, watermark_file_path) VALUES (?, ?, ?, ?, ?)`;
  db.query(sql, [userName, product_price, description, original_file_path, watermark_file_path], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to create product' });
    }
    res.status(201).json({ message: 'Product created', prod_id: result.insertId });
  });
});

app.post('/freelancer/products/:prod_id/send', authenticateToken, (req, res) => {
  const { prod_id } = req.params;
  const userName = req.freelancer.userName;

  const checkSql = `SELECT * FROM product WHERE prod_id = ? AND userName = ?`;
  db.query(checkSql, [prod_id, userName], (err, results) => {
    if (err) return res.status(500).json({ error: 'Server error' });
    if (results.length === 0) {
      return res.status(404).json({ error: 'Product not found or not yours' });
    }

    const link_token = crypto.randomBytes(32).toString('hex');
    const insertSql = `INSERT INTO transaction (link_token, prod_id) VALUES (?, ?)`;
    db.query(insertSql, [link_token, prod_id], (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Failed to create transaction link' });
      }
      const shareableLink = `${process.env.BACKEND_URL}/transaction/${link_token}/preview`;
      res.status(201).json({ message: 'Link created', link: shareableLink });
    });
  });
});

app.delete('/freelancer/products/:prod_id', authenticateToken, (req, res) => {
  const prodId = req.params.prod_id;
  const userName = req.freelancer.userName;

  db.query(
    'SELECT original_file_path, watermark_file_path FROM product WHERE prod_id = ? AND userName = ?',
    [prodId, userName],
    (err, results) => {
      if (err || results.length === 0) {
        console.error('Delete: product not found or DB error', err);
        return res.status(404).json({ error: 'Product not found' });
      }

      const product = results[0];
      const filesToDelete = [product.original_file_path, product.watermark_file_path].filter(Boolean);

      filesToDelete.forEach(filePath => {
        const fullPath = path.resolve(filePath);
        if (fs.existsSync(fullPath)) {
          try {
            fs.unlinkSync(fullPath);
          } catch (e) {
            console.error(`Failed to delete file ${fullPath}:`, e.message);
          }
        }
      });

      db.query('DELETE FROM transaction WHERE prod_id = ?', [prodId], (err2) => {
        if (err2) {
          console.error('Delete: failed to remove transactions:', err2);
          return res.status(500).json({ error: 'Failed to delete related transactions' });
        }

        db.query('DELETE FROM product WHERE prod_id = ?', [prodId], (err3) => {
          if (err3) {
            console.error('Delete: DB delete error:', err3);
            return res.status(500).json({ error: 'Failed to delete product' });
          }
          res.json({ success: true });
        });
      });
    }
  );
});

app.post('/freelancer/connect-razorpay', authenticateToken, async (req, res) => {
  const userName = req.freelancer.userName;
  const { email, phone, legal_business_name, ifsc, account_number, beneficiary_name } = req.body;

  try {
    const account = await razorpay.accounts.create({
      email,
      phone,
      type: 'route',
      legal_business_name,
      business_type: 'individual',
      contact_name: beneficiary_name
    });

    const sql = `UPDATE freeLancer SET razorpay_account_id = ? WHERE userName = ?`;
    db.query(sql, [account.id, userName], (err) => {
      if (err) return res.status(500).json({ error: 'Failed to save account' });
      res.json({ message: 'Razorpay account connected', accountId: account.id });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create Razorpay account', details: err.error?.description });
  }
});

// ─── Transaction / Payment routes ──────────────────────────
app.get('/transaction/:token/preview', (req, res) => {
  res.sendFile(__dirname + '/public/checkout.html');
});

app.get('/api/transaction/:token/preview', (req, res) => {
  const { token } = req.params;
  const sql = `
    SELECT product.watermark_file_path, product.product_price, product.description, transaction.transactionStatus
    FROM transaction
    JOIN product ON transaction.prod_id = product.prod_id
    WHERE transaction.link_token = ?
  `;

  db.query(sql, [token], (err, results) => {
    if (err) return res.status(500).json({ error: 'Server error' });
    if (results.length === 0) {
      return res.status(404).json({ error: 'Invalid or expired link' });
    }
    const data = results[0];
    res.json({
      description: data.description,
      price: data.product_price,
      status: data.transactionStatus,
      previewUrl: `${process.env.BACKEND_URL}/${data.watermark_file_path}`
    });
  });
});

app.post('/transaction/:token/create-order', async (req, res) => {
  const { token } = req.params;
  const sql = `
    SELECT product.product_price, transaction.transactionStatus, freeLancer.razorpay_account_id
    FROM transaction
    JOIN product ON transaction.prod_id = product.prod_id
    JOIN freeLancer ON product.userName = freeLancer.userName
    WHERE transaction.link_token = ?
  `;

  db.query(sql, [token], async (err, results) => {
    if (err) return res.status(500).json({ error: 'Server error' });
    if (results.length === 0) return res.status(404).json({ error: 'Invalid link' });

    const data = results[0];
    if (data.transactionStatus === 'paid') return res.status(400).json({ error: 'Already paid' });

    const orderPayload = {
      amount: data.product_price * 100,
      currency: 'INR',
      receipt: token.substring(0, 40)
    };

    if (data.razorpay_account_id) {
      orderPayload.transfers = [{
        account: data.razorpay_account_id,
        amount: data.product_price * 100,
        currency: 'INR'
      }];
    }

    try {
      const order = await razorpay.orders.create(orderPayload);
      res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create payment order' });
    }
  });
});

app.post('/transaction/:token/verify', (req, res) => {
  const { token } = req.params;
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  const body = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ success: false, error: 'Payment verification failed' });
  }

  const sql = `UPDATE transaction SET transactionStatus = 'paid' WHERE link_token = ?`;
  db.query(sql, [token], (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, error: 'Failed to update status' });
    }
    res.json({ success: true });
  });
});

app.get('/transaction/:token/download', (req, res) => {
  const { token } = req.params;
  const sql = `
    SELECT product.original_file_path, transaction.transactionStatus
    FROM transaction
    JOIN product ON transaction.prod_id = product.prod_id
    WHERE transaction.link_token = ?
  `;

  db.query(sql, [token], (err, results) => {
    if (err) return res.status(500).json({ error: 'Server error' });
    if (results.length === 0) return res.status(404).json({ error: 'Invalid link' });

    const data = results[0];
    if (data.transactionStatus !== 'paid') {
      return res.status(403).json({ error: 'Payment required before download' });
    }

    res.download(__dirname + '/' + data.original_file_path);
  });
});

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});