import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

// Webhook URL (replace with your Render URL)
const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook`;

// Set webhook
bot.setWebHook(webhookUrl)
  .then(() => console.log('Webhook set successfully'))
  .catch(err => console.error('Error setting webhook:', err));

app.use(express.json());
app.use(express.static('public'));

// Webhook endpoint
app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body); // Process the update
  res.sendStatus(200); // Acknowledge receipt
});

// Root endpoint for UptimeRobot
app.get('/', (req, res) => {
  res.send('Bot is running!');
});

// Define file paths
const productsFile = path.join(__dirname, 'products.json');
const analyticsFile = path.join(__dirname, 'analytics.json');

// Initialize analytics data
async function initializeAnalytics() {
  try {
    await fs.access(analyticsFile);
  } catch {
    await fs.writeFile(analyticsFile, JSON.stringify({ queries: [], traffic: 0, productViews: {} }));
  }
}

initializeAnalytics();

async function readProducts() {
  try {
    const data = await fs.readFile(productsFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading products:', error);
    return [];
  }
}

async function writeProducts(products) {
  try {
    await fs.writeFile(productsFile, JSON.stringify(products, null, 2));
  } catch (error) {
    console.error('Error writing products:', error);
  }
}

async function readAnalytics() {
  try {
    const data = await fs.readFile(analyticsFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading analytics:', error);
    return { queries: [], traffic: 0, productViews: {} };
  }
}

async function writeAnalytics(analytics) {
  try {
    await fs.writeFile(analyticsFile, JSON.stringify(analytics, null, 2));
  } catch (error) {
    console.error('Error writing analytics:', error);
  }
}

// Track user queries and traffic
async function trackQuery(chatId, query) {
  const analytics = await readAnalytics();
  analytics.queries.push({ chatId, query, timestamp: new Date(), status: 'Success' }); // Change status to 'Success'
  analytics.traffic += 1;
  await writeAnalytics(analytics);
}

// Track product views
async function trackProductView(productId) {
  const analytics = await readAnalytics();
  if (!analytics.productViews[productId]) {
    analytics.productViews[productId] = 0;
  }
  analytics.productViews[productId] += 1;
  await writeAnalytics(analytics);
}

// Telegram Bot Handlers
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userName = msg.from.first_name; // Fetch the user's first name

  // Send a personalized welcome message
  bot.sendMessage(chatId, `Welcome, ${userName}! Please enter a product name to search.`);
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpMessage = `
    <b>Help Center</b>
    <i>Here are the details you need:</i>

    <b>📧 Email:</b> gggamer9848@gmail.com
    <b>🌐 Website:</b> <a href="https://kpavan63.github.io/Help-Center/#">Visit Us</a>
  `;
  bot.sendMessage(chatId, helpMessage, { parse_mode: 'HTML' });
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userInput = msg.text;

  if (userInput.startsWith('/')) return; // Ignore commands

  await trackQuery(chatId, userInput);

  try {
    const products = await readProducts();
    const matchedProducts = products.filter(product =>
      product.keywords.some(keyword => keyword.toLowerCase().includes(userInput.toLowerCase()))
    ).slice(0, 5);

    if (matchedProducts.length === 0) {
      bot.sendMessage(chatId, 'No products found. Please try a different search term.');
      return;
    }

    const keyboard = matchedProducts.map(product => [{ text: product.name, callback_data: product.id.toString() }]);
    bot.sendMessage(chatId, 'Select a product:', { reply_markup: { inline_keyboard: keyboard } });
  } catch (error) {
    console.error('Error searching products:', error);
    bot.sendMessage(chatId, 'An error occurred while searching for products. Please try again later.');
  }
});

bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const productId = callbackQuery.data;

  console.log(`Product ID selected: ${productId}`); // Log the selected product ID

  try {
    // Track product view
    await trackProductView(productId);

    // Read products from the JSON file
    const products = await readProducts();
    console.log(`All products: ${JSON.stringify(products)}`); // Log all products

    // Find the selected product by ID
    const product = products.find(p => p.id.toString() === productId);
    if (!product) {
      console.log(`Product not found for ID: ${productId}`); // Log if product is not found
      bot.sendMessage(chatId, 'Product not found.');
      return;
    }

    console.log(`Product found: ${JSON.stringify(product)}`); // Log the found product

    // Create the HTML message for the product
    const htmlMessage = `
  <b>🎧 ${product.name}</b>
  
  ${product.description}
  
  <b>💰 Price:</b> ₹${product.price.toFixed(2)}
  <b>💵 MRP:</b> <s>₹${product.mrp.toFixed(2)}</s>
  <b>⭐ Rating:</b> ${product.rating} ⭐
`;

    // Create the inline keyboard with buttons
    const inlineKeyboard = {
      inline_keyboard: [
        [{ text: 'View Product', url: `${process.env.RENDER_EXTERNAL_URL}/product/${product.id}` }],
        [{ text: 'Order Now', url: product.buyLink }]
      ]
    };

    // Send the product details to the user
    if (product.image) {
      // Send the product image with a caption
      await bot.sendPhoto(chatId, product.image, {
        caption: htmlMessage,
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard
      });
    } else {
      // If no image is available, send a text message
      await bot.sendMessage(chatId, htmlMessage, {
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard
      });
    }
  } catch (error) {
    console.error('Error in callback_query handler:', error); // Log the full error
    bot.sendMessage(chatId, 'An error occurred while fetching product details. Please try again later.');
  }
});

// API Routes
app.get('/api/products', async (req, res) => {
  try {
    const products = await readProducts();
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching products', error: error.message });
  }
});

app.get('/api/analytics', async (req, res) => {
  try {
    const analytics = await readAnalytics();
    res.json(analytics);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching analytics', error: error.message });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const products = await readProducts();
    const newProduct = {
      id: Date.now(),
      ...req.body
    };
    products.push(newProduct);
    await writeProducts(products);
    res.status(201).json(newProduct);
  } catch (error) {
    res.status(400).json({ message: 'Error creating product', error: error.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    let products = await readProducts();
    products = products.filter(p => p.id.toString() !== req.params.id);
    await writeProducts(products);
    res.status(204).end();
  } catch (error) {
    res.status(400).json({ message: 'Error deleting product', error: error.message });
  }
});

// API to send messages to users
app.post('/api/send-message', async (req, res) => {
  const { chatId, message } = req.body;

  try {
    await bot.sendMessage(chatId, message);
    res.status(200).json({ success: true, message: 'Message sent successfully!' });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
});

// New endpoint to fetch user profile
app.get('/api/user-profile/:chatId', async (req, res) => {
  const chatId = req.params.chatId;

  try {
    // Fetch user info
    const userInfoResponse = await axios.get(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getChat`,
      { params: { chat_id: chatId } }
    );

    if (!userInfoResponse.data.ok) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userInfo = userInfoResponse.data.result;

    // Fetch user profile photo
    let photoUrl = null;
    const photosResponse = await axios.get(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getUserProfilePhotos`,
      { params: { user_id: chatId, limit: 1 } }
    );

    if (photosResponse.data.ok && photosResponse.data.result.total_count > 0) {
      const fileId = photosResponse.data.result.photos[0][0].file_id;
      const fileResponse = await axios.get(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile`,
        { params: { file_id: fileId } }
      );

      if (fileResponse.data.ok) {
        photoUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${fileResponse.data.result.file_path}`;
      }
    }

    // Return user profile data
    res.json({
      id: userInfo.id,
      first_name: userInfo.first_name,
      last_name: userInfo.last_name || '',
      username: userInfo.username || '',
      photo_url: photoUrl,
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// Serve Chat ID Input Page
app.get('/user-profile', (req, res) => {
  const chatIdInputPage = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Enter Chat ID</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 20px;
          background: linear-gradient(-45deg, #ee7752, #e73c7e, #23a6d5, #23d5ab);
          background-size: 400% 400%;
          animation: gradientBackground 15s ease infinite;
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
        }

        @keyframes gradientBackground {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        .container {
          background: rgba(255, 255, 255, 0.9);
          padding: 20px;
          border-radius: 10px;
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
          max-width: 400px;
          width: 100%;
          text-align: center;
        }

        h1 {
          color: #333;
          margin-bottom: 20px;
        }

        input {
          width: 100%;
          padding: 10px;
          margin-bottom: 20px;
          border: 1px solid #ccc;
          border-radius: 5px;
        }

        button {
          padding: 10px 20px;
          background-color: #28a745;
          color: white;
          border: none;
          border-radius: 5px;
          cursor: pointer;
        }

        button:hover {
          background-color: #218838;
        }

        .profile-card {
          margin-top: 20px;
          padding: 20px;
          background: #fff;
          border-radius: 10px;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        }

        .profile-card img {
          width: 100px;
          height: 100px;
          border-radius: 50%;
          margin-bottom: 10px;
        }

        .profile-card p {
          margin: 5px 0;
        }

        /* Loader Animation */
        .loader {
          border: 4px solid #f3f3f3; /* Light grey */
          border-top: 4px solid #3498db; /* Blue */
          border-radius: 50%;
          width: 30px;
          height: 30px;
          animation: spin 1s linear infinite;
          margin: 20px auto;
          display: none; /* Hidden by default */
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Enter Chat ID</h1>
        <input type="text" id="chatIdInput" placeholder="Enter Chat ID">
        <button onclick="fetchUserProfile()">View Profile</button>

        <!-- Loader -->
        <div class="loader" id="loader"></div>

        <!-- User Profile Display -->
        <div id="profileDisplay" class="profile-card" style="display: none;">
          <img id="profilePhoto" src="" alt="Profile Photo">
          <p><strong>ID:</strong> <span id="userId"></span></p>
          <p><strong>Name:</strong> <span id="userName"></span></p>
          <p><strong>Username:</strong> <span id="userUsername"></span></p>
        </div>
      </div>

      <script>
        async function fetchUserProfile() {
          const chatId = document.getElementById('chatIdInput').value;
          if (!chatId) {
            alert('Please enter a valid Chat ID.');
            return;
          }

          // Show loader
          document.getElementById('loader').style.display = 'block';
          document.getElementById('profileDisplay').style.display = 'none';

          try {
            const response = await fetch(\`/api/user-profile/\${chatId}\`);
            const user = await response.json();

            if (response.ok) {
              // Display user profile
              document.getElementById('profileDisplay').style.display = 'block';
              document.getElementById('profilePhoto').src = user.photo_url || 'https://via.placeholder.com/100';
              document.getElementById('userId').textContent = user.id;
              document.getElementById('userName').textContent = \`\${user.first_name} \${user.last_name || ''}\`;
              document.getElementById('userUsername').textContent = user.username || 'N/A';
            } else {
              alert(user.error || 'Failed to fetch user profile.');
            }
          } catch (error) {
            console.error('Error fetching user profile:', error);
            alert('An error occurred. Please try again.');
          } finally {
            // Hide loader
            document.getElementById('loader').style.display = 'none';
          }
        }
      </script>
    </body>
    </html>
  `;
  res.send(chatIdInputPage);
});

// Serve Admin Panel HTML with PIN Authentication
app.get('/admin', (req, res) => {
  const adminLoginHTML = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Admin Login</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 0;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          background: linear-gradient(135deg, #6a11cb, #2575fc);
          color: #fff;
        }

        .login-container {
          background: rgba(255, 255, 255, 0.1);
          padding: 40px;
          border-radius: 20px;
          box-shadow: 0 15px 25px rgba(0, 0, 0, 0.2);
          backdrop-filter: blur(10px);
          text-align: center;
          width: 350px;
        }

        .login-container h2 {
          margin-bottom: 20px;
          font-size: 24px;
          color: #fff;
        }

        .pin-input {
          display: flex;
          justify-content: center;
          gap: 10px;
          margin-bottom: 20px;
        }

        .pin-input input {
          width: 50px;
          height: 50px;
          text-align: center;
          font-size: 20px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
          outline: none;
          transition: border-color 0.3s ease;
        }

        .pin-input input:focus {
          border-color: #fff;
        }

        .submit-btn {
          width: 100%;
          padding: 15px;
          background: linear-gradient(135deg, #6a11cb, #2575fc);
          border: none;
          border-radius: 10px;
          color: #fff;
          font-size: 16px;
          cursor: pointer;
          transition: background 0.3s ease;
        }

        .submit-btn:hover {
          background: linear-gradient(135deg, #2575fc, #6a11cb);
        }

        .error-message {
          color: #ff6b6b;
          margin-top: 10px;
          font-size: 14px;
          display: none;
        }

        /* Animations */
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-10px); }
          50% { transform: translateX(10px); }
          75% { transform: translateX(-10px); }
        }

        .shake {
          animation: shake 0.5s ease-in-out;
        }
      </style>
    </head>
    <body>
      <div class="login-container">
        <h2>Enter Admin PIN</h2>
        <form action="/admin/dashboard" method="POST" onsubmit="return validatePin()">
          <div class="pin-input">
            <input type="password" name="pin1" maxlength="1" required>
            <input type="password" name="pin2" maxlength="1" required>
            <input type="password" name="pin3" maxlength="1" required>
            <input type="password" name="pin4" maxlength="1" required>
          </div>
          <button type="submit" class="submit-btn">Submit</button>
          <div class="error-message" id="error-message">Invalid PIN. Please try again.</div>
        </form>
      </div>

      <script>
        function validatePin() {
          const pin1 = document.querySelector('input[name="pin1"]').value;
          const pin2 = document.querySelector('input[name="pin2"]').value;
          const pin3 = document.querySelector('input[name="pin3"]').value;
          const pin4 = document.querySelector('input[name="pin4"]').value;
          const enteredPin = pin1 + pin2 + pin3 + pin4;

          if (enteredPin !== '${process.env.ADMIN_PIN}') {
            document.getElementById('error-message').style.display = 'block';
            document.querySelector('.pin-input').classList.add('shake');
            setTimeout(() => {
              document.querySelector('.pin-input').classList.remove('shake');
            }, 500);
            return false;
          }
          return true;
        }
      </script>
    </body>
    </html>
  `;
  res.send(adminLoginHTML);
});

// Serve Admin Dashboard (protected route)
app.post('/admin/dashboard', (req, res) => {
  const { pin1, pin2, pin3, pin4 } = req.body;
  const enteredPin = pin1 + pin2 + pin3 + pin4;

  // Validate the PIN
  if (enteredPin === process.env.ADMIN_PIN) {
    // Serve the admin dashboard
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Admin Dashboard</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            background: linear-gradient(135deg, #6a11cb, #2575fc);
            color: #fff;
          }
          .admin-panel {
            background: rgba(255, 255, 255, 0.1);
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 15px 25px rgba(0, 0, 0, 0.2);
            backdrop-filter: blur(10px);
            text-align: center;
            width: 350px;
          }
          .admin-panel h1 {
            margin-bottom: 20px;
            font-size: 24px;
            color: #fff;
          }
          .admin-panel a {
            color: #007bff;
            text-decoration: none;
          }
          .admin-panel a:hover {
            text-decoration: underline;
          }
        </style>
      </head>
      <body>
        <div class="admin-panel">
          <h1>Welcome to the Admin Dashboard!</h1>
          <p><a href="/">Go Back</a></p>
        </div>
      </body>
      </html>
    `);
  } else {
    res.send('Invalid PIN. <a href="/admin">Try again</a>');
  }
});

// Serve Add Product HTML
app.get('/admin/add-product', (req, res) => {
  const addProductHTML = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Add Product</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 20px;
        }
        h1 {
          color: #333;
        }
        form {
          margin-top: 20px;
        }
        label {
          display: block;
          margin-top: 10px;
        }
        input, textarea {
          width: 100%;
          padding: 8px;
          margin-top: 5px;
        }
        button {
          margin-top: 20px;
          padding: 10px 20px;
          background-color: #28a745;
          color: white;
          border: none;
          cursor: pointer;
        }
        button:hover {
          background-color: #218838;
        }
        a {
          display: inline-block;
          margin-top: 20px;
          color: #007bff;
          text-decoration: none;
        }
        a:hover {
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
      <div class="container mt-5">
        <h1 class="mb-4">Add Product</h1>
        <form id="addProductForm">
          <div class="mb-3">
            <label for="name" class="form-label">Name:</label>
            <input type="text" class="form-control" id="name" name="name" required>
          </div>
          <div class="mb-3">
            <label for="description" class="form-label">Description:</label>
            <textarea class="form-control" id="description" name="description" required></textarea>
          </div>
          <div class="mb-3">
            <label for="price" class="form-label">Price:</label>
            <input type="number" class="form-control" id="price" name="price" step="0.01" required>
          </div>
          <div class="mb-3">
            <label for="mrp" class="form-label">MRP:</label>
            <input type="number" class="form-control" id="mrp" name="mrp" step="0.01" required>
          </div>
          <div class="mb-3">
            <label for="rating" class="form-label">Rating:</label>
            <input type="number" class="form-control" id="rating" name="rating" step="0.1" required>
          </div>
          <div class="mb-3">
            <label for="image" class="form-label">Image URL:</label>
            <input type="url" class="form-control" id="image" name="image" required>
          </div>
          <div class="mb-3">
            <label for="productLink" class="form-label">Product Link:</label>
            <input type="url" class="form-control" id="productLink" name="productLink" required>
          </div>
          <div class="mb-3">
            <label for="buyLink" class="form-label">Buy Link:</label>
            <input type="url" class="form-control" id="buyLink" name="buyLink" required>
          </div>
          <div class="mb-3">
            <label for="keywords" class="form-label">Keywords (comma-separated):</label>
            <input type="text" class="form-control" id="keywords" name="keywords" required>
          </div>
          <button type="submit" class="btn btn-primary">Add Product</button>
        </form>
        <a href="/admin" class="btn btn-secondary mt-3">Back to Dashboard</a>
      </div>

      <script>
        document.getElementById('addProductForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const formData = new FormData(e.target);
          const data = Object.fromEntries(formData.entries());
          data.keywords = data.keywords.split(',').map(k => k.trim());

          try {
            const response = await axios.post('/api/products', data);
            alert('Product added successfully!');
            window.location.href = '/admin';
          } catch (error) {
            alert('Error adding product');
            console.error(error);
          }
        });
      </script>
    </body>
    </html>
  `;
  res.send(addProductHTML);
});

// Serve Product Details Page
app.get('/product/:id', async (req, res) => {
  try {
    const products = await readProducts();
    const product = products.find(p => p.id.toString() === req.params.id);
    if (!product) {
      res.status(404).send('Product not found');
      return;
    }

    const productPage = `
      <!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${product.name}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <style>
    /* Background Animation */
    @keyframes gradientBackground {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }

    body {
      font-family: Arial, sans-serif;
      background: linear-gradient(-45deg, #ee7752, #e73c7e, #23a6d5, #23d5ab);
      background-size: 400% 400%;
      animation: gradientBackground 15s ease infinite;
      margin: 0;
      padding: 20px;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }

    .product-card {
      background: rgba(255, 255, 255, 0.9);
      border-radius: 15px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
      padding: 20px;
      max-width: 800px; /* Increased max-width for desktop */
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      animation: fadeIn 1s ease-in-out;
    }

    @media (min-width: 768px) {
      .product-card {
        flex-direction: row; /* Change to row layout for desktop */
        align-items: flex-start;
      }
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .product-image {
      max-width: 100%;
      border-radius: 10px;
      margin-bottom: 20px;
      animation: slideIn 1s ease-in-out;
    }

    @media (min-width: 768px) {
      .product-image {
        max-width: 50%; /* Adjust image width for desktop */
        margin-right: 20px; /* Add spacing between image and content */
        margin-bottom: 0;
      }
    }

    @keyframes slideIn {
      from { opacity: 0; transform: translateX(-20px); }
      to { opacity: 1; transform: translateX(0); }
    }

    .product-details {
      animation: fadeIn 1.5s ease-in-out;
      text-align: center;
    }

    @media (min-width: 768px) {
      .product-details {
        text-align: left; /* Align text to the left for desktop */
      }
    }

    .product-details h1 {
      font-size: 2rem;
      margin-bottom: 10px;
      color: #333;
    }

    .product-details p {
      font-size: 1rem;
      color: #555;
      margin-bottom: 10px;
    }

    .product-details .price {
      font-size: 1.5rem;
      color: #e73c7e;
      font-weight: bold;
    }

    .product-details .mrp {
      font-size: 1.2rem;
      color: #777;
      text-decoration: line-through;
    }

    .product-details .rating {
      font-size: 1.2rem;
      color: #ffc107;
    }

    .btn-order {
      background: linear-gradient(45deg, #e73c7e, #23a6d5);
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 25px;
      font-size: 1rem;
      cursor: pointer;
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }

    .btn-order:hover {
      transform: scale(1.05);
      box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
    }
  </style>
</head>
<body>
  <div class="product-card">
    <img src="${product.image}" alt="${product.name}" class="product-image">
    <div class="product-details">
      <h1>${product.name}</h1>
      <p>${product.description}</p>
      <p class="price">💰 Price: ₹${product.price.toFixed(2)}</p>
      <p class="mrp">💵 MRP: <s>₹${product.mrp.toFixed(2)}</s></p>
      <p class="rating">⭐ Rating: ${product.rating} ⭐</p>
      <a href="${product.buyLink}" class="btn-order">Order Now</a>
    </div>
  </div>
</body>
</html>
    `;

    res.send(productPage);
  } catch (error) {
    console.error('Error loading product details:', error);
    res.status(500).send('Error loading product details');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

console.log('Bot is running...');
