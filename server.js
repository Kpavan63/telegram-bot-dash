import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import axios from 'axios';
import pg from 'pg'; // Import pg as default
const { Client } = pg; // Destructure Client from pg

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
// Define file path for today's deals
const todayDealsFile = path.join(__dirname, 'today-deals.json');

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

// Initialize today's deals data
async function initializeTodayDeals() {
  try {
    await fs.access(todayDealsFile);
  } catch {
    // If the file doesn't exist, create it with an empty array
    await fs.writeFile(todayDealsFile, JSON.stringify([]));
  }
}

initializeTodayDeals();

// Function to read today's deals
async function readTodayDeals() {
  try {
    const data = await fs.readFile(todayDealsFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading today deals:', error);
    return [];
  }
}

// Function to write today's deals
async function writeTodayDeals(deals) {
  try {
    await fs.writeFile(todayDealsFile, JSON.stringify(deals, null, 2));
  } catch (error) {
    console.error('Error writing today deals:', error);
  }
}


// PostgreSQL client
const dbClient = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Required for Render's PostgreSQL
  },
});

// Connect to the database
dbClient.connect()
  .then(() => console.log('Connected to PostgreSQL database'))
  .catch(err => console.error('Error connecting to PostgreSQL database:', err));

// Initialize the users table
async function initializeDatabase() {
  try {
    await dbClient.query(`
      CREATE TABLE IF NOT EXISTS users (
        chat_id BIGINT PRIMARY KEY
      );
    `);
    console.log('Users table initialized.');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

initializeDatabase();

// Function to read users
async function readUsers() {
  try {
    const res = await dbClient.query('SELECT chat_id FROM users');
    return res.rows.map(row => row.chat_id);
  } catch (error) {
    console.error('Error reading users:', error);
    return [];
  }
}

// Function to write users
async function writeUsers(chatId) {
    try {
        // Ensure chatId is a valid number
        if (typeof chatId === 'string' && chatId.startsWith('{')) {
            // Parse JSON-like string if required
            chatId = JSON.parse(chatId);
        }
        chatId = Number(chatId); // Convert to a plain number

        if (isNaN(chatId)) {
            throw new Error(`Invalid chatId: ${chatId}`);
        }

        // Insert into database
        await dbClient.query(
            'INSERT INTO users (chat_id) VALUES ($1) ON CONFLICT (chat_id) DO NOTHING',
            [chatId]
        );
    } catch (error) {
        console.error('Error writing user:', error);
    }
}

// Serve static files from the "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// Route to serve the admin notification panel
app.get('/admin/notify', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-notify.html'));
});

// API to send notifications
app.post('/admin/send-notification', async (req, res) => {
  const { image, text, link } = req.body;

  try {
    const users = await readUsers();

    // Send notification to each user
    for (const chatId of users) {
      try {
        if (image) {
          // Send image with caption
          await bot.sendPhoto(chatId, image, { caption: text });
        } else {
          // Send text message
          await bot.sendMessage(chatId, text);
        }

        // Send link if provided
        if (link) {
          await bot.sendMessage(chatId, `🔗 Link: ${link}`);
        }
      } catch (error) {
        console.error(`Error sending notification to chat ID ${chatId}:`, error);
      }
    }

    res.json({ success: true, message: 'Notification sent to all users!' });
  } catch (error) {
    console.error('Error sending notifications:', error);
    res.status(500).json({ success: false, message: 'Failed to send notifications.' });
  }
});

// Telegram Bot Handlers
bot.onText(/\/start/, async (msg) => {
    let chatId = msg.chat.id;
    const userName = msg.from.first_name; // Fetch the user's first name

    try {
        // Convert and validate chatId
        if (typeof chatId === 'string' && chatId.startsWith('{')) {
            chatId = JSON.parse(chatId);
        }
        chatId = Number(chatId);

        if (isNaN(chatId)) {
            console.error('Invalid chatId:', chatId);
            return;
        }

        const users = await readUsers();

        // Add the chat ID if it doesn't already exist
        if (!users.includes(chatId)) {
            await writeUsers(chatId);
        }

        // Send a personalized welcome message
        bot.sendMessage(chatId, `Welcome, ${userName}! Please enter a product name to search.`);
    } catch (error) {
        console.error('Error handling /start command:', error);
    }
});

bot.onText(/\/today/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const todayDeals = await readTodayDeals();

    if (todayDeals.length === 0) {
      bot.sendMessage(chatId, 'No deals available for today.');
      return;
    }

    // Loop through each deal and send it as a separate message
    for (const deal of todayDeals) {
      const htmlMessage = `
<b>Deal:</b>
 <b>${deal.name}</b>
💰 Price: ₹${deal.price.toFixed(2)}
💵 MRP: ₹${deal.mrp.toFixed(2)}
⭐ Rating: ${deal.rating} ⭐
`;

      // Create the inline keyboard with an "Order Now" button
      const inlineKeyboard = {
        inline_keyboard: [
          [{ text: 'Order Now', url: deal.buyLink }] // Add the "Order Now" button
        ]
      };

      // Send the deal details to the user
      if (deal.image) {
        // Send the deal image with a caption
        await bot.sendPhoto(chatId, deal.image, {
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
    }
  } catch (error) {
    console.error('Error fetching today deals:', error);
    bot.sendMessage(chatId, 'An error occurred while fetching today\'s deals. Please try again later.');
  }
});

// API Route to serve today's deals
app.get('/api/today-deals', async (req, res) => {
  try {
    const todayDeals = await readTodayDeals();
    res.json(todayDeals);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching today deals', error: error.message });
  }
});

// API Route to update today's deals (POST request)
app.post('/api/today-deals', async (req, res) => {
  try {
    const newDeals = req.body; // Expecting an array of deals
    await writeTodayDeals(newDeals);
    res.status(201).json({ success: true, message: 'Today deals updated successfully!' });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Error updating today deals', error: error.message });
  }
});

// telegram bot to help handler
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

// Serve Admin Panel HTML
// Serve Admin Panel HTML with PIN Authentication
// Serve Admin Panel HTML with PIN Authentication
// Serve Admin Panel HTML with PIN Authentication
app.get('/admin', (req, res) => {
  const adminHTML = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Admin Dashboard</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
      <style>
        /* General Styles */
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 20px;
          background: linear-gradient(-45deg, #ee7752, #e73c7e, #23a6d5, #23d5ab);
          background-size: 400% 400%;
          animation: gradientBackground 15s ease infinite;
          min-height: 100vh;
          color: #333;
        }

        @keyframes gradientBackground {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        h1, h2 {
          color: #fff;
          text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
        }

        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
          background: rgba(255, 255, 255, 0.9);
          border-radius: 10px;
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
        }

        /* PIN Popup Card */
        .pin-popup {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(255, 255, 255, 0.95);
          padding: 20px;
          border-radius: 10px;
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
          z-index: 1000;
          text-align: center;
        }

        .pin-popup h2 {
          margin-bottom: 20px;
          color: #333;
        }

        .pin-input-container {
          display: flex;
          justify-content: center;
          gap: 10px;
          margin-bottom: 20px;
        }

        .pin-input-container input {
          width: 50px;
          height: 50px;
          text-align: center;
          font-size: 20px;
          border: 2px solid #007bff;
          border-radius: 5px;
        }

        .pin-input-container input:focus {
          outline: none;
          border-color: #0056b3;
        }

        .pin-popup button {
          padding: 10px 20px;
          background-color: #007bff;
          color: white;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          font-size: 16px;
        }

        .pin-popup button:hover {
          background-color: #0056b3;
        }

        .pin-error {
          color: red;
          margin-top: 10px;
        }

        /* Hide admin features by default */
        #adminFeatures {
          display: none;
        }
      </style>

      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js"></script>
    </head>
    <body>
      <!-- PIN Popup Card -->
      <div class="pin-popup" id="pinPopup">
        <h2>Enter PIN to Access Admin Panel</h2>
        <div class="pin-input-container">
          <input type="text" id="pin1" maxlength="1" oninput="moveToNext(1)" />
          <input type="text" id="pin2" maxlength="1" oninput="moveToNext(2)" />
          <input type="text" id="pin3" maxlength="1" oninput="moveToNext(3)" />
          <input type="text" id="pin4" maxlength="1" oninput="moveToNext(4)" />
        </div>
        <button onclick="verifyPin()">Submit</button>
        <div id="pinError" class="pin-error"></div>
      </div>

      <!-- Admin Features (hidden by default) -->
      <div class="container mt-5" id="adminFeatures">
        <h1 class="mb-4" style="color:black;">Admin Dashboard</h1>

        <!-- Dashboard Cards -->
        <div class="row mb-4">
          <div class="col-md-4">
            <div class="card">
              <div class="card-body">
                <h5 class="card-title">Total Products</h5>
                <p class="card-text" id="totalProducts">0</p>
              </div>
            </div>
          </div>
          <div class="col-md-4">
            <div class="card">
              <div class="card-body">
                <h5 class="card-title">Most Viewed Product</h5>
                <p class="card-text" id="mostViewedProduct">N/A</p>
              </div>
            </div>
          </div>
          <div class="col-md-4">
            <div class="card">
              <div class="card-body">
                <h5 class="card-title">Realtime Traffic</h5>
                <p class="card-text" id="realtimeTraffic">0</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Query Status -->
        <h2 class="mt-4" style="color:black;">Query Status</h2>
        <table class="table table-bordered">
          <thead>
            <tr>
              <th>Chat ID</th>
              <th>Query</th>
              <th>Timestamp</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="queryTable">
            <!-- Queries will be populated here -->
          </tbody>
        </table>

        <!-- Chat Window -->
        <h2 class="mt-4" style="color:black;">Chat with User</h2>
        <div class="chat-window" id="chatWindow">
          <!-- Chat messages will be displayed here -->
        </div>
        <div class="input-group mt-3">
          <input type="text" id="chatInput" class="form-control" placeholder="Type your message...">
          <button class="btn btn-primary" id="sendMessageBtn">Send</button>
        </div>

        <!-- Product Views -->
        <h2 class="mt-4" style="color:black;">Product Views</h2>
        <table class="table table-bordered">
          <thead>
            <tr>
              <th>Product ID</th>
              <th>Views</th>
            </tr>
          </thead>
          <tbody id="productViewsTable">
            <!-- Product views will be populated here -->
          </tbody>
        </table>

        <!-- Realtime Traffic Chart -->
        <h2 class="mt-4" style="color:black;">Realtime Traffic Chart</h2>
        <canvas id="realtimeTrafficChart"></canvas>

        <a href="/admin/add-product" class="btn btn-primary mt-4">Add Product</a>
        <a href="/user-profile" class="btn btn-secondary mt-4">View User Profile</a>
        <a href="/admin/notify" class="btn btn-primary mt-4">Send Notification to All Users</a>
        <a href="/admin/today-deals" class="btn btn-primary mt-4">Today's Deals</a>
      </div>

      <script>
        const correctPin = '${process.env.ADMIN_PIN || '6300'}'; // Fetch PIN from environment variable or use default

        // Check if the PIN has already been verified
        const isPinVerified = localStorage.getItem('pinVerified') === 'true';

        if (isPinVerified) {
          // Hide the PIN popup and show the admin features
          document.getElementById('pinPopup').style.display = 'none';
          document.getElementById('adminFeatures').style.display = 'block';
        }

        // Function to move to the next input box
        function moveToNext(currentInput) {
          const nextInput = document.getElementById(\`pin\${currentInput + 1}\`);
          if (nextInput && document.getElementById(\`pin\${currentInput}\`).value) {
            nextInput.focus();
          }
        }

        // Function to verify the PIN
        function verifyPin() {
          const pin1 = document.getElementById('pin1').value;
          const pin2 = document.getElementById('pin2').value;
          const pin3 = document.getElementById('pin3').value;
          const pin4 = document.getElementById('pin4').value;
          const enteredPin = pin1 + pin2 + pin3 + pin4;

          const pinError = document.getElementById('pinError');
          const adminFeatures = document.getElementById('adminFeatures');
          const pinPopup = document.getElementById('pinPopup');

          if (enteredPin === correctPin) {
            // Hide the PIN popup and show the admin features
            pinPopup.style.display = 'none';
            adminFeatures.style.display = 'block';

            // Store the PIN verification state in local storage
            localStorage.setItem('pinVerified', 'true');
          } else {
            // Show an error message
            pinError.textContent = 'Invalid PIN. Please try again.';
          }
        }

        let currentChatId = null;

        // Fetch analytics data
        async function fetchAnalytics() {
          try {
            const response = await axios.get('/api/analytics');
            const analytics = response.data;

            // Update total products
            const productsResponse = await axios.get('/api/products');
            document.getElementById('totalProducts').textContent = productsResponse.data.length;

            // Update most viewed product
            const mostViewedProductId = Object.keys(analytics.productViews).reduce((a, b) => 
              analytics.productViews[a] > analytics.productViews[b] ? a : b
            );
            const mostViewedProduct = productsResponse.data.find(p => p.id.toString() === mostViewedProductId);
            document.getElementById('mostViewedProduct').textContent = mostViewedProduct ? mostViewedProduct.name : 'N/A';

            // Update realtime traffic
            document.getElementById('realtimeTraffic').textContent = analytics.traffic;

            // Update query status table
            const queryTable = document.getElementById('queryTable');
            queryTable.innerHTML = analytics.queries.map(query => \`
              <tr>
                <td>\${query.chatId}</td>
                <td>\${query.query}</td>
                <td>\${new Date(query.timestamp).toLocaleString()}</td>
                <td><span class="badge bg-success">\${query.status}</span></td>
                <td><button class="btn btn-sm btn-primary" onclick="openChat(\${query.chatId})">Chat</button></td>
              </tr>
            \`).join('');

            // Update product views table
            const productViewsTable = document.getElementById('productViewsTable');
            productViewsTable.innerHTML = Object.entries(analytics.productViews).map(([id, views]) => \`
              <tr>
                <td>\${id}</td>
                <td><i class="fas fa-eye"></i> \${views}</td>
              </tr>
            \`).join('');

            // Update realtime traffic chart
            const ctx = document.getElementById('realtimeTrafficChart').getContext('2d');
            const trafficChart = new Chart(ctx, {
              type: 'line',
              data: {
                labels: analytics.queries.map((_, index) => \`Query \${index + 1}\`),
                datasets: [{
                  label: 'Traffic',
                  data: analytics.queries.map(() => Math.floor(Math.random() * 100)), // Simulated traffic data
                  borderColor: 'rgba(75, 192, 192, 1)',
                  borderWidth: 1,
                  fill: false
                }]
              },
              options: {
                scales: {
                  y: {
                    beginAtZero: true
                  }
                }
              }
            });
          } catch (error) {
            console.error('Error fetching analytics:', error);
          }
        }

        // Open chat with a user
        function openChat(chatId) {
          currentChatId = chatId;
          document.getElementById('chatWindow').innerHTML = '<p>Start chatting with the user...</p>';
        }

        // Send message to user
        document.getElementById('sendMessageBtn').addEventListener('click', async () => {
          const message = document.getElementById('chatInput').value;
          if (!message || !currentChatId) return;

          try {
            const response = await axios.post('/api/send-message', { chatId: currentChatId, message });
            if (response.data.success) {
              const chatWindow = document.getElementById('chatWindow');
              chatWindow.innerHTML += \`<div class="chat-message admin">\${message}</div>\`;
              document.getElementById('chatInput').value = '';
            }
          } catch (error) {
            console.error('Error sending message:', error);
          }
        });

        // Fetch analytics data every 5 seconds
        fetchAnalytics();
        setInterval(fetchAnalytics, 5000);
      </script>
    </body>
    </html>
  `;
  res.send(adminHTML);
});
//today deals admin code
app.get('/admin/today-deals', async (req, res) => {
  try {
    const todayDeals = await readTodayDeals();
    const analytics = await readAnalytics();
    const productViews = analytics.productViews;

    let dealsHTML = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Today's Deals | Admin Dashboard</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.7.0/chart.min.js"></script>
        <style>
          :root {
            --primary-color: #2563eb;
            --secondary-color: #1e40af;
            --background-color: #f3f4f6;
            --card-background: #ffffff;
            --text-primary: #1f2937;
            --text-secondary: #4b5563;
            --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
            --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
            --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1);
            --accent-gradient: linear-gradient(135deg, #3b82f6, #2563eb);
          }

          [data-theme="dark"] {
            --background-color: #1f2937;
            --card-background: #374151;
            --text-primary: #f3f4f6;
            --text-secondary: #d1d5db;
            --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.3);
            --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.4);
            --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.4);
          }

          /* ... (Previous CSS remains the same) ... */

          .theme-toggle {
            position: fixed;
            top: 1rem;
            right: 1rem;
            padding: 0.5rem;
            border-radius: 50%;
            background: var(--card-background);
            box-shadow: var(--shadow-md);
            border: none;
            cursor: pointer;
            z-index: 1000;
            transition: all 0.3s ease;
          }

          .theme-toggle:hover {
            transform: rotate(180deg);
          }

          .filters {
            max-width: 1200px;
            margin: 0 auto 2rem;
            display: flex;
            gap: 1rem;
            justify-content: center;
            flex-wrap: wrap;
          }

          .filter-btn {
            padding: 0.5rem 1rem;
            border: none;
            border-radius: 2rem;
            background: var(--card-background);
            color: var(--text-primary);
            cursor: pointer;
            transition: all 0.3s ease;
          }

          .filter-btn.active {
            background: var(--accent-gradient);
            color: white;
          }

          .deal-card {
            position: relative;
            perspective: 1000px;
          }

          .deal-card.flipped .card-inner {
            transform: rotateY(180deg);
          }

          .card-inner {
            position: relative;
            width: 100%;
            height: 100%;
            transition: transform 0.6s;
            transform-style: preserve-3d;
          }

          .card-front,
          .card-back {
            position: absolute;
            width: 100%;
            height: 100%;
            backface-visibility: hidden;
            background: var(--card-background);
            border-radius: 1rem;
          }

          .card-back {
            transform: rotateY(180deg);
            padding: 1.5rem;
          }

          .chart-container {
            width: 100%;
            height: 200px;
          }

          .quick-actions {
            display: flex;
            gap: 0.5rem;
            margin-top: 1rem;
          }

          .action-btn {
            flex: 1;
            padding: 0.5rem;
            border: none;
            border-radius: 0.5rem;
            background: var(--accent-gradient);
            color: white;
            cursor: pointer;
            transition: all 0.3s ease;
          }

          .action-btn:hover {
            opacity: 0.9;
            transform: translateY(-2px);
          }

          .notification {
            position: fixed;
            bottom: 2rem;
            right: 2rem;
            padding: 1rem 2rem;
            background: var(--accent-gradient);
            color: white;
            border-radius: 0.5rem;
            box-shadow: var(--shadow-lg);
            transform: translateX(200%);
            transition: transform 0.3s ease;
          }

          .notification.show {
            transform: translateX(0);
          }

          .search-container {
            max-width: 600px;
            margin: 0 auto 2rem;
            position: relative;
          }

          .search-input {
            width: 100%;
            padding: 1rem 1.5rem;
            border: none;
            border-radius: 2rem;
            background: var(--card-background);
            color: var(--text-primary);
            box-shadow: var(--shadow-md);
            transition: all 0.3s ease;
          }

          .search-input:focus {
            outline: none;
            box-shadow: var(--shadow-lg);
          }

          .loading-skeleton {
            animation: skeleton-loading 1s linear infinite alternate;
          }

          @keyframes skeleton-loading {
            0% {
              background-color: rgba(129, 129, 129, 0.1);
            }
            100% {
              background-color: rgba(129, 129, 129, 0.3);
            }
          }

          /* ... (Previous CSS remains the same) ... */
        </style>
      </head>
      <body>
        <button class="theme-toggle" onclick="toggleTheme()">
          <i class="fas fa-moon"></i>
        </button>

        <header class="page-header">
          <h1 class="page-title">Today's Featured Deals</h1>
          <p class="page-subtitle">Discover our exclusive daily offers</p>
        </header>

        <div class="search-container">
          <input type="text" class="search-input" placeholder="Search deals..." onkeyup="searchDeals(this.value)">
        </div>

        <div class="filters">
          <button class="filter-btn active" onclick="filterDeals('all')">All Deals</button>
          <button class="filter-btn" onclick="filterDeals('trending')">Trending</button>
          <button class="filter-btn" onclick="filterDeals('highDiscount')">Highest Discount</button>
        </div>

        <div class="deal-container">
    `;

    if (todayDeals.length === 0) {
      dealsHTML += `
        <div class="no-deals">
          <i class="fas fa-shopping-basket fa-3x" style="color: var(--text-secondary); margin-bottom: 1rem;"></i>
          <p>No deals available for today. Check back later!</p>
        </div>
      `;
    } else {
      todayDeals.forEach((deal, index) => {
        const views = productViews[deal.id] || 0;
        const clicks = (analytics.queries.filter(query => query.query.includes(deal.name)).length) || 0;
        const discountPercentage = Math.round(((deal.mrp - deal.price) / deal.mrp) * 100);
        
        dealsHTML += `
          <div class="deal-card" style="animation-delay: ${index * 0.1}s" onclick="flipCard(this)">
            <div class="card-inner">
              <div class="card-front">
                <div class="deal-image-container">
                  <img src="${deal.image}" alt="${deal.name}" class="deal-image" loading="lazy">
                </div>
                <div class="deal-content">
                  <h2 class="deal-title">${deal.name}</h2>
                  <div class="deal-price">
                    <span class="current-price">₹${deal.price.toFixed(2)}</span>
                    <span class="original-price">₹${deal.mrp.toFixed(2)}</span>
                    <span class="discount-badge">${discountPercentage}% OFF</span>
                  </div>
                  <div class="deal-stats">
                    <div class="stat-item">
                      <i class="fas fa-eye"></i>
                      <span>${views.toLocaleString()} views</span>
                    </div>
                    <div class="stat-item">
                      <i class="fas fa-mouse-pointer"></i>
                      <span>${clicks.toLocaleString()} clicks</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="card-back">
                <h3>Performance Analytics</h3>
                <div class="chart-container">
                  <canvas id="chart-${deal.id}"></canvas>
                </div>
                <div class="quick-actions">
                  <button class="action-btn" onclick="editDeal('${deal.id}')">
                    <i class="fas fa-edit"></i> Edit
                  </button>
                  <button class="action-btn" onclick="shareDeal('${deal.id}')">
                    <i class="fas fa-share"></i> Share
                  </button>
                </div>
              </div>
            </div>
          </div>
        `;
      });
    }

    dealsHTML += `
        </div>
        <div style="text-align: center;">
          <a href="/admin" class="back-link">
            <i class="fas fa-arrow-left"></i>
            Back to Dashboard
          </a>
        </div>

        <div class="notification" id="notification">
          <span id="notification-text"></span>
        </div>

        <script>
          // Theme Toggle
          function toggleTheme() {
            document.body.dataset.theme = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
            localStorage.setItem('theme', document.body.dataset.theme);
          }

          // Initialize theme from localStorage
          document.body.dataset.theme = localStorage.getItem('theme') || 'light';

          // Card Flip
          function flipCard(card) {
            card.classList.toggle('flipped');
          }

          // Search Functionality
          function searchDeals(query) {
            const cards = document.querySelectorAll('.deal-card');
            query = query.toLowerCase();
            
            cards.forEach(card => {
              const title = card.querySelector('.deal-title').textContent.toLowerCase();
              card.style.display = title.includes(query) ? 'block' : 'none';
            });
          }

          // Filter Functionality
          function filterDeals(filter) {
            const buttons = document.querySelectorAll('.filter-btn');
            buttons.forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');

            const cards = document.querySelectorAll('.deal-card');
            cards.forEach(card => {
              const price = parseFloat(card.querySelector('.current-price').textContent.replace('₹', ''));
              const views = parseInt(card.querySelector('.fa-eye').nextElementSibling.textContent);
              
              switch(filter) {
                case 'trending':
                  card.style.display = views > 1000 ? 'block' : 'none';
                  break;
                case 'highDiscount':
                  const mrp = parseFloat(card.querySelector('.original-price').textContent.replace('₹', ''));
                  const discount = ((mrp - price) / mrp) * 100;
                  card.style.display = discount > 50 ? 'block' : 'none';
                  break;
                default:
                  card.style.display = 'block';
              }
            });
          }

          // Initialize Charts
          function initializeCharts() {
            ${todayDeals.map(deal => `
              new Chart(document.getElementById('chart-${deal.id}').getContext('2d'), {
                type: 'line',
                data: {
                  labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
                  datasets: [{
                    label: 'Views',
                    data: [
                      ${Array.from({length: 5}, () => Math.floor(Math.random() * 1000))},
                    ],
                    borderColor: '#3b82f6',
                    tension: 0.4
                  }]
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      display: false
                    }
                  },
                  scales: {
                    y: {
                      beginAtZero: true
                    }
                  }
                }
              });
            `).join('\n')}
          }

          // Quick Actions
          function showNotification(message) {
            const notification = document.getElementById('notification');
            const notificationText = document.getElementById('notification-text');
            notificationText.textContent = message;
            notification.classList.add('show');
            setTimeout(() => notification.classList.remove('show'), 3000);
          }

          function editDeal(id) {
            event.stopPropagation();
            showNotification('Edit mode enabled for deal #' + id);
          }

          function shareDeal(id) {
            event.stopPropagation();
            const shareData = {
              title: 'Amazing Deal',
              text: 'Check out this amazing deal!',
              url: window.location.href + '#deal-' + id
            };
            
            if (navigator.share) {
              navigator.share(shareData)
                .then(() => showNotification('Deal shared successfully!'))
                .catch(() => showNotification('Failed to share deal'));
            } else {
              showNotification('Sharing is not supported on this device');
            }
          }

          // Initialize everything
          document.addEventListener('DOMContentLoaded', () => {
            initializeCharts();
          });

          // Lazy Loading
          const lazyImages = document.querySelectorAll('img[loading="lazy"]');
          const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
              if (entry.isIntersecting) {
                                const img = entry.target;
                img.src = img.dataset.src;
                img.classList.add('loaded');
                observer.unobserve(img);
              }
            });
          });

          lazyImages.forEach(img => imageObserver.observe(img));

          // Add smooth scroll animation
          document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
              e.preventDefault();
              document.querySelector(this.getAttribute('href')).scrollIntoView({
                behavior: 'smooth'
              });
            });
          });

          // Add card hover effect with mouse position
          document.querySelectorAll('.deal-card').forEach(card => {
            card.addEventListener('mousemove', (e) => {
              const rect = card.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const y = e.clientY - rect.top;

              const centerX = rect.width / 2;
              const centerY = rect.height / 2;

              const rotateX = (y - centerY) / 20;
              const rotateY = (centerX - x) / 20;

              card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
            });

            card.addEventListener('mouseleave', () => {
              card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0)';
            });
          });

          // Add keyboard shortcuts
          document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === '/') {
              document.querySelector('.search-input').focus();
            }
          });

          // Add drag and drop reordering
          let draggedCard = null;

          document.querySelectorAll('.deal-card').forEach(card => {
            card.setAttribute('draggable', true);
            
            card.addEventListener('dragstart', function(e) {
              draggedCard = this;
              this.classList.add('dragging');
            });

            card.addEventListener('dragend', function() {
              this.classList.remove('dragging');
            });

            card.addEventListener('dragover', function(e) {
              e.preventDefault();
              if (draggedCard !== this) {
                const container = document.querySelector('.deal-container');
                const afterElement = getDragAfterElement(container, e.clientY);
                if (afterElement) {
                  container.insertBefore(draggedCard, afterElement);
                } else {
                  container.appendChild(draggedCard);
                }
              }
            });
          });

          function getDragAfterElement(container, y) {
            const draggableElements = [...container.querySelectorAll('.deal-card:not(.dragging)')];
            
            return draggableElements.reduce((closest, child) => {
              const box = child.getBoundingClientRect();
              const offset = y - box.top - box.height / 2;
              
              if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
              } else {
                return closest;
              }
            }, { offset: Number.NEGATIVE_INFINITY }).element;
          }

          // Add performance monitoring
          const performanceData = {
            loadTime: 0,
            renderTime: 0,
            interactions: 0
          };

          window.addEventListener('load', () => {
            performanceData.loadTime = performance.now();
            console.log('Page Load Time:', performanceData.loadTime + 'ms');
          });

          // Add real-time price updates (simulation)
          setInterval(() => {
            document.querySelectorAll('.current-price').forEach(price => {
              const currentPrice = parseFloat(price.textContent.replace('₹', ''));
              const variation = (Math.random() - 0.5) * 10;
              const newPrice = (currentPrice + variation).toFixed(2);
              
              if (newPrice !== currentPrice) {
                price.style.animation = 'none';
                price.offsetHeight; // Trigger reflow
                price.style.animation = 'priceUpdate 0.5s ease';
                price.textContent = '₹' + newPrice;
              }
            });
          }, 5000);

          // Add view count animation
          function animateValue(element, start, end, duration) {
            const range = end - start;
            const startTime = performance.now();
            
            function update() {
              const currentTime = performance.now();
              const elapsed = currentTime - startTime;
              const progress = Math.min(elapsed / duration, 1);
              
              const value = Math.floor(start + (range * progress));
              element.textContent = value.toLocaleString() + ' views';
              
              if (progress < 1) {
                requestAnimationFrame(update);
              }
            }
            
            requestAnimationFrame(update);
          }

          // Initialize view count animations
          document.querySelectorAll('.stat-item .fa-eye').forEach(icon => {
            const viewCount = parseInt(icon.nextElementSibling.textContent);
            animateValue(icon.nextElementSibling, 0, viewCount, 2000);
          });
        </script>
      </body>
      </html>
    `;

    res.send(dealsHTML);
  } catch (error) {
    console.error('Error fetching today deals:', error);
    res.status(500).send('Error loading today\'s deals.');
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
