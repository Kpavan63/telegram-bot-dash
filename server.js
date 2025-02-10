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
      <title>Admin Dashboard | Advanced</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
      <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>
        :root {
          --primary-color: #023047;
          --secondary-color: #219ebc;
          --accent-color: #ffb703;
          --warning-color: #fb8500;
          --info-color: #8ecae6;
          --text-color: #333;
          --bg-gradient: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
        }

        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'Poppins', sans-serif;
          background: var(--bg-gradient);
          background-size: 400% 400%;
          animation: gradientBackground 15s ease infinite;
          min-height: 100vh;
          color: var(--text-color);
        }

        @keyframes gradientBackground {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        .header {
          background: rgba(255, 255, 255, 0.95);
          padding: 1rem;
          position: sticky;
          top: 0;
          z-index: 1000;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        }

        .header-content {
          display: flex;
          justify-content: space-between;
          align-items: center;
          max-width: 1400px;
          margin: 0 auto;
        }

        .user-info {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .user-avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: var(--accent-color);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: bold;
        }

        .container {
          max-width: 1400px;
          margin: 2rem auto;
          padding: 0 1rem;
        }

        .dashboard-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 1.5rem;
          margin-bottom: 2rem;
        }

        .card {
          background: rgba(255, 255, 255, 0.95);
          border-radius: 15px;
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
          transition: transform 0.3s ease;
          overflow: hidden;
        }

        .card:hover {
          transform: translateY(-5px);
        }

        .card-header {
          background: var(--primary-color);
          color: white;
          padding: 1rem;
          font-weight: 500;
        }

        .card-body {
          padding: 1.5rem;
        }

        .stat-card {
          background: var(--bg-gradient);
          color: white;
        }

        .stat-value {
          font-size: 2rem;
          font-weight: 600;
          margin: 1rem 0;
        }

        .chart-card {
          min-height: 400px;
        }

        .table-responsive {
          max-height: 300px;
          overflow-y: auto;
        }

        .table {
          margin: 0;
        }

        .chat-window {
          height: 300px;
          overflow-y: auto;
          padding: 1rem;
          background: #f8f9fa;
          border-radius: 10px;
        }

        .chat-message {
          margin-bottom: 1rem;
          padding: 0.5rem 1rem;
          border-radius: 10px;
          max-width: 80%;
        }

        .chat-message.admin {
          background: var(--secondary-color);
          color: white;
          margin-left: auto;
        }

        .chat-message.user {
          background: var(--info-color);
          color: var(--text-color);
        }

        .status-badge {
          padding: 0.25rem 0.75rem;
          border-radius: 20px;
          font-size: 0.875rem;
        }

        .status-badge.active {
          background: var(--accent-color);
          color: white;
        }

        @media (max-width: 768px) {
          .header-content {
            flex-direction: column;
            gap: 1rem;
            text-align: center;
          }

          .dashboard-grid {
            grid-template-columns: 1fr;
          }

          .stat-value {
            font-size: 1.5rem;
          }
        }

        .loading {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(255, 255, 255, 0.8);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 9999;
        }

        .loading-spinner {
          width: 50px;
          height: 50px;
          border: 5px solid var(--info-color);
          border-top: 5px solid var(--primary-color);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    </head>
    <body>
      <div id="loading" class="loading">
        <div class="loading-spinner"></div>
      </div>

      <header class="header">
        <div class="header-content">
          <div class="user-info">
            <div class="user-avatar">
              ${req.query.username ? req.query.username.charAt(0).toUpperCase() : 'A'}
            </div>
            <div>
              <h6 class="mb-0">${req.query.username || 'Admin'}</h6>
              <small class="text-muted" id="currentUTC"></small>
            </div>
          </div>
          <div>
            <button class="btn btn-outline-primary" onclick="logout()">
              <i class="fas fa-sign-out-alt"></i> Logout
            </button>
          </div>
        </div>
      </header>

      <div class="container">
        <div class="dashboard-grid">
          <!-- Stats Cards -->
          <div class="card stat-card">
            <div class="card-body">
              <h5>Total Products</h5>
              <div class="stat-value" id="totalProducts">0</div>
              <div class="stat-change">
                <i class="fas fa-arrow-up"></i> +5% from last week
              </div>
            </div>
          </div>

          <div class="card stat-card">
            <div class="card-body">
              <h5>Active Users</h5>
              <div class="stat-value" id="activeUsers">0</div>
              <div class="stat-change">
                <i class="fas fa-users"></i> Currently Online
              </div>
            </div>
          </div>

          <div class="card stat-card">
            <div class="card-body">
              <h5>Today's Revenue</h5>
              <div class="stat-value" id="todayRevenue">$0</div>
              <div class="stat-change">
                <i class="fas fa-chart-line"></i> Real-time Updates
              </div>
            </div>
          </div>
        </div>

        <!-- Traffic Chart -->
        <div class="card chart-card mb-4">
          <div class="card-header">
            Real-time Traffic Analytics
          </div>
          <div class="card-body">
            <div id="trafficChart"></div>
          </div>
        </div>

        <!-- Activity Grid -->
        <div class="dashboard-grid">
          <!-- User Activity -->
          <div class="card">
            <div class="card-header">
              User Activity
            </div>
            <div class="card-body">
              <div id="userActivityHeatmap"></div>
            </div>
          </div>

          <!-- Recent Transactions -->
          <div class="card">
            <div class="card-header">
              Recent Transactions
            </div>
            <div class="card-body table-responsive">
              <table class="table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>User</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody id="transactionsTable">
                  <!-- Transactions will be inserted here -->
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Chat Section -->
        <div class="card mb-4">
          <div class="card-header">
            Live Customer Support
          </div>
          <div class="card-body">
            <div class="chat-window" id="chatWindow"></div>
            <div class="input-group mt-3">
              <input type="text" class="form-control" id="chatInput" placeholder="Type your message...">
              <button class="btn btn-primary" id="sendMessageBtn">
                <i class="fas fa-paper-plane"></i> Send
              </button>
            </div>
          </div>
        </div>
      </div>

      <script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
      <script src="https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js"></script>
      <script>
        // Update UTC time
        function updateUTCTime() {
          const now = new Date();
          document.getElementById('currentUTC').textContent = 
            now.toISOString().replace('T', ' ').substr(0, 19) + ' UTC';
        }

        setInterval(updateUTCTime, 1000);
        updateUTCTime();

        // Generate random data for charts
        function generateRandomData(count = 10) {
          return Array.from({ length: count }, () => Math.floor(Math.random() * 100));
        }

        // Initialize traffic chart
        const trafficChart = new ApexCharts(document.getElementById('trafficChart'), {
          series: [{
            name: 'Traffic',
            data: generateRandomData()
          }],
          chart: {
            type: 'area',
            height: 350,
            animations: {
              enabled: true,
              easing: 'linear',
              dynamicAnimation: {
                speed: 1000
              }
            },
            toolbar: {
              show: false
            },
            zoom: {
              enabled: false
            }
          },
          dataLabels: {
            enabled: false
          },
          stroke: {
            curve: 'smooth',
            width: 3
          },
          fill: {
            type: 'gradient',
            gradient: {
              shadeIntensity: 1,
              opacityFrom: 0.7,
              opacityTo: 0.3,
              stops: [0, 90, 100]
            }
          },
          xaxis: {
            categories: Array.from({ length: 10 }, (_, i) => `${i + 1}m ago`),
            labels: {
              show: true
            }
          },
          yaxis: {
            labels: {
              show: true
            }
          },
          colors: ['#219ebc']
        });

        trafficChart.render();

        // Update traffic chart every second
        setInterval(() => {
          const newData = [...trafficChart.w.globals.series[0].data.slice(1), Math.floor(Math.random() * 100)];
          trafficChart.updateSeries([{
            data: newData
          }]);
        }, 1000);

        // Initialize heatmap
        const heatmapChart = new ApexCharts(document.getElementById('userActivityHeatmap'), {
          series: [{
            name: 'Users',
            data: generateRandomData(24)
          }],
          chart: {
            type: 'heatmap',
            height: 350,
            toolbar: {
              show: false
            }
          },
          plotOptions: {
            heatmap: {
              shadeIntensity: 0.5,
              radius: 0,
              useFillColorAsStroke: true,
              colorScale: {
                ranges: [{
                  from: 0,
                  to: 40,
                  name: 'Low',
                  color: '#8ecae6'
                }, {
                  from: 41,
                  to: 70,
                  name: 'Medium',
                  color: '#219ebc'
                }, {
                  from: 71,
                  to: 100,
                  name: 'High',
                  color: '#023047'
                }]
              }
            }
          },
          dataLabels: {
            enabled: false
          },
          xaxis: {
            categories: Array.from({ length: 24 }, (_, i) => `${i}:00`)
          }
        });

        heatmapChart.render();

        // Update stats randomly
        function updateStats() {
          document.getElementById('totalProducts').textContent = Math.floor(Math.random() * 1000);
          document.getElementById('activeUsers').textContent = Math.floor(Math.random() * 100);
          document.getElementById('todayRevenue').textContent = 
            '$' + (Math.floor(Math.random() * 10000) / 100).toFixed(2) + 'k';
        }

        // Update transactions table
        function updateTransactions() {
          const statuses = ['success', 'pending', 'failed'];
          const users = ['John D.', 'Alice M.', 'Bob K.', 'Sarah L.'];
          const transactions = Array.from({ length: 10 }, (_, i) => ({
            id: Math.floor(Math.random() * 1000000),
            user: users[Math.floor(Math.random() * users.length)],
            amount: '$' + (Math.floor(Math.random() * 1000) / 100).toFixed(2),
            status: statuses[Math.floor(Math.random() * statuses.length)]
          }));

          const tbody = document.getElementById('transactionsTable');
          tbody.innerHTML = transactions.map(t => `
            <tr>
              <td>#${t.id}</td>
              <td>${t.user}</td>
              <td>${t.user}</td>
              <td>${t.amount}</td>
              <td>
                <span class="status-badge ${t.status}">
                  ${t.status.charAt(0).toUpperCase() + t.status.slice(1)}
                </span>
              </td>
            </tr>
          `).join('');
        }

        // Initialize everything and start real-time updates
        let chatMessages = [];
        const currentUser = 'Kpavan63';
        const currentUTC = '2025-02-10 14:00:20';

        function initializeDashboard() {
          // Update header with user info
          document.querySelector('.user-avatar').textContent = currentUser.charAt(0).toUpperCase();
          document.querySelector('.user-info h6').textContent = currentUser;
          document.getElementById('currentUTC').textContent = currentUTC;

          // Start real-time updates
          updateStats();
          updateTransactions();
          setInterval(updateStats, 3000);
          setInterval(updateTransactions, 5000);

          // Remove loading screen
          document.getElementById('loading').style.display = 'none';
        }

        // Chat functionality
        document.getElementById('sendMessageBtn').addEventListener('click', () => {
          const input = document.getElementById('chatInput');
          const message = input.value.trim();
          
          if (message) {
            const chatWindow = document.getElementById('chatWindow');
            chatMessages.push({
              text: message,
              sender: 'admin',
              timestamp: new Date().toISOString()
            });

            // Update chat window
            chatWindow.innerHTML = chatMessages.map(msg => `
              <div class="chat-message ${msg.sender}">
                <div class="message-content">${msg.text}</div>
                <small class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</small>
              </div>
            `).join('');

            // Clear input and scroll to bottom
            input.value = '';
            chatWindow.scrollTop = chatWindow.scrollHeight;
          }
        });

        // Handle chat input enter key
        document.getElementById('chatInput').addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            document.getElementById('sendMessageBtn').click();
          }
        });

        // Logout function
        function logout() {
          localStorage.removeItem('pinVerified');
          localStorage.removeItem('pinExpiry');
          window.location.reload();
        }

        // Custom styles for status badges
        const statusStyles = document.createElement('style');
        statusStyles.textContent = `
          .status-badge {
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.875rem;
            font-weight: 500;
          }
          .status-badge.success {
            background-color: #28a745;
            color: white;
          }
          .status-badge.pending {
            background-color: #ffc107;
            color: #000;
          }
          .status-badge.failed {
            background-color: #dc3545;
            color: white;
          }
        `;
        document.head.appendChild(statusStyles);

        // Initialize dashboard when DOM is loaded
        document.addEventListener('DOMContentLoaded', initializeDashboard);

        // Handle window resize for responsive charts
        window.addEventListener('resize', () => {
          trafficChart.render();
          heatmapChart.render();
        });

        // Add some sample chat messages
        setTimeout(() => {
          const sampleMessages = [
            { text: "Welcome to the admin dashboard!", sender: "system", timestamp: new Date().toISOString() },
            { text: "How can I help you today?", sender: "admin", timestamp: new Date().toISOString() }
          ];
          
          chatMessages = [...sampleMessages];
          const chatWindow = document.getElementById('chatWindow');
          chatWindow.innerHTML = chatMessages.map(msg => `
            <div class="chat-message ${msg.sender}">
              <div class="message-content">${msg.text}</div>
              <small class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</small>
            </div>
          `).join('');
          chatWindow.scrollTop = chatWindow.scrollHeight;
        }, 1000);

        // Add pulse animation to real-time indicators
        const pulseStyle = document.createElement('style');
        pulseStyle.textContent = `
          .stat-change i {
            animation: pulse 2s infinite;
          }
          
          @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
          }
        `;
        document.head.appendChild(pulseStyle);

        // Add tooltip functionality
        const tooltips = document.querySelectorAll('[data-tooltip]');
        tooltips.forEach(tooltip => {
          tooltip.style.position = 'relative';
          tooltip.addEventListener('mouseenter', (e) => {
            const tooltipText = document.createElement('div');
            tooltipText.className = 'tooltip';
            tooltipText.textContent = tooltip.dataset.tooltip;
            tooltipText.style.position = 'absolute';
            tooltipText.style.bottom = '100%';
            tooltipText.style.left = '50%';
            tooltipText.style.transform = 'translateX(-50%)';
            tooltipText.style.backgroundColor = 'rgba(0,0,0,0.8)';
            tooltipText.style.color = 'white';
            tooltipText.style.padding = '5px 10px';
            tooltipText.style.borderRadius = '5px';
            tooltipText.style.fontSize = '12px';
            tooltipText.style.zIndex = '1000';
            tooltip.appendChild(tooltipText);
          });
          tooltip.addEventListener('mouseleave', () => {
            const tooltipText = tooltip.querySelector('.tooltip');
            if (tooltipText) tooltipText.remove();
          });
        });

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
    const categories = [...new Set(todayDeals.map(deal => deal.category))];

    let dealsHTML = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Today's Deals | Admin Dashboard</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
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
          }

          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
            background-color: var(--background-color);
            color: var(--text-primary);
            line-height: 1.5;
            padding: 2rem 1rem;
          }

          .page-header {
            max-width: 1200px;
            margin: 0 auto 2rem;
            text-align: center;
            opacity: 0;
            animation: fadeInDown 0.6s ease-out forwards;
          }

          .page-title {
            font-size: 2.5rem;
            font-weight: 700;
            color: var(--text-primary);
            margin-bottom: 1rem;
          }

          .page-subtitle {
            color: var(--text-secondary);
            font-size: 1.1rem;
          }

          .filter-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            max-width: 1200px;
            margin: 0 auto 2rem;
            padding: 0 1rem;
          }

          .filter-bar select,
          .filter-bar input {
            padding: 0.5rem 1rem;
            border: 1px solid #e5e7eb;
            border-radius: 0.5rem;
            font-size: 1rem;
          }

          .deal-container {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 2rem;
            max-width: 1200px;
            margin: 0 auto;
            padding: 1rem;
          }

          .deal-card {
            background: var(--card-background);
            border-radius: 1rem;
            overflow: hidden;
            box-shadow: var(--shadow-md);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            opacity: 0;
            transform: translateY(20px);
            animation: fadeInUp 0.6s ease-out forwards;
          }

          .deal-card:hover {
            transform: translateY(-5px);
            box-shadow: var(--shadow-lg);
          }

          .deal-image-container {
            position: relative;
            padding-top: 66.67%;
            overflow: hidden;
          }

          .deal-image {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            transition: transform 0.5s ease;
          }

          .deal-card:hover .deal-image {
            transform: scale(1.05);
          }

          .deal-content {
            padding: 1.5rem;
          }

          .deal-title {
            font-size: 1.25rem;
            font-weight: 600;
            color: var(--text-primary);
            margin-bottom: 0.75rem;
          }

          .deal-price {
            display: flex;
            align-items: baseline;
            gap: 0.75rem;
            margin-bottom: 1rem;
          }

          .current-price {
            font-size: 1.5rem;
            font-weight: 700;
            color: var(--primary-color);
          }

          .original-price {
            color: var(--text-secondary);
            text-decoration: line-through;
          }

          .discount-badge {
            background: #dcfce7;
            color: #166534;
            padding: 0.25rem 0.75rem;
            border-radius: 1rem;
            font-size: 0.875rem;
            font-weight: 500;
          }

          .deal-stats {
            display: flex;
            justify-content: space-between;
            padding-top: 1rem;
            border-top: 1px solid #e5e7eb;
          }

          .stat-item {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            color: var(--text-secondary);
            font-size: 0.875rem;
          }

          .stat-item i {
            color: var(--primary-color);
          }

          .back-link {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            color: var(--primary-color);
            text-decoration: none;
            font-weight: 500;
            margin-top: 2rem;
            padding: 0.75rem 1.5rem;
            border-radius: 0.5rem;
            background: var(--card-background);
            box-shadow: var(--shadow-sm);
            transition: all 0.2s ease;
          }

          .back-link:hover {
            background: var(--primary-color);
            color: white;
            box-shadow: var(--shadow-md);
          }

          .no-deals {
            text-align: center;
            padding: 3rem;
            background: var(--card-background);
            border-radius: 1rem;
            box-shadow: var(--shadow-md);
          }

          .pagination {
            display: flex;
            justify-content: center;
            gap: 0.5rem;
            margin-top: 2rem;
          }

          .pagination a {
            padding: 0.5rem 1rem;
            border-radius: 0.5rem;
            background: var(--card-background);
            box-shadow: var(--shadow-sm);
            text-decoration: none;
            color: var(--primary-color);
            font-weight: 500;
            transition: all 0.2s ease;
          }

          .pagination a:hover {
            background: var(--primary-color);
            color: white;
            box-shadow: var(--shadow-md);
          }

          @keyframes fadeInDown {
            from {
              opacity: 0;
              transform: translateY(-20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          @keyframes fadeInUp {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          /* Responsive Design */
          @media (max-width: 768px) {
            .page-title {
              font-size: 2rem;
            }

            .deal-container {
              grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
              gap: 1rem;
            }

            .deal-content {
              padding: 1rem;
            }

            .filter-bar {
              flex-direction: column;
              gap: 1rem;
            }
          }

          @media (max-width: 480px) {
            body {
              padding: 1rem 0.5rem;
            }

            .page-title {
              font-size: 1.75rem;
            }

            .deal-container {
              grid-template-columns: 1fr;
            }
          }
        </style>
        <script>
          function filterDeals() {
            const searchQuery = document.getElementById('search').value.toLowerCase();
            const category = document.getElementById('category').value;
            const deals = document.querySelectorAll('.deal-card');

            deals.forEach(deal => {
              const title = deal.querySelector('.deal-title').textContent.toLowerCase();
              const dealCategory = deal.dataset.category;

              if (title.includes(searchQuery) && (category === 'all' || dealCategory === category)) {
                deal.style.display = 'block';
              } else {
                deal.style.display = 'none';
              }
            });
          }

          function sortDeals() {
            const sortOption = document.getElementById('sort').value;
            const dealContainer = document.querySelector('.deal-container');
            const deals = Array.from(dealContainer.children);

            deals.sort((a, b) => {
              const priceA = parseFloat(a.querySelector('.current-price').textContent.replace('₹', ''));
              const priceB = parseFloat(b.querySelector('.current-price').textContent.replace('₹', ''));
              const discountA = parseInt(a.querySelector('.discount-badge').textContent.replace('% OFF', ''));
              const discountB = parseInt(b.querySelector('.discount-badge').textContent.replace('% OFF', ''));
              const viewsA = parseInt(a.querySelector('.stat-item span').textContent.replace(',', ''));
              const viewsB = parseInt(b.querySelector('.stat-item span').textContent.replace(',', ''));

              if (sortOption === 'price-asc') {
                return priceA - priceB;
              } else if (sortOption === 'price-desc') {
                return priceB - priceA;
              } else if (sortOption === 'discount') {
                return discountB - discountA;
              } else if (sortOption === 'views') {
                return viewsB - viewsA;
              }
            });

            dealContainer.innerHTML = '';
            deals.forEach(deal => dealContainer.appendChild(deal));
          }

          function openModal(dealId) {
            const modal = document.getElementById('deal-modal');
            const deal = document.querySelector(\`.deal-card[data-id="\${dealId}"]\`);

            modal.querySelector('.modal-title').textContent = deal.querySelector('.deal-title').textContent;
            modal.querySelector('.modal-image').src = deal.querySelector('.deal-image').src;
            modal.querySelector('.modal-price').textContent = deal.querySelector('.current-price').textContent;
            modal.querySelector('.modal-description').textContent = deal.querySelector('.deal-description').textContent;

            modal.style.display = 'block';
          }

          function closeModal() {
            const modal = document.getElementById('deal-modal');
            modal.style.display = 'none';
          }
        </script>
      </head>
      <body>
        <header class="page-header">
          <h1 class="page-title">Today's Featured Deals</h1>
          <p class="page-subtitle">Discover our exclusive daily offers</p>
        </header>
        <div class="filter-bar">
          <input type="text" id="search" placeholder="Search deals..." onkeyup="filterDeals()">
          <select id="category" onchange="filterDeals()">
            <option value="all">All Categories</option>
            ${categories.map(category => `<option value="${category}">${category}</option>`).join('')}
          </select>
          <select id="sort" onchange="sortDeals()">
            <option value="price-asc">Sort by Price: Low to High</option>
            <option value="price-desc">Sort by Price: High to Low</option>
            <option value="discount">Sort by Discount</option>
            <option value="views">Sort by Views</option>
          </select>
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
          <div class="deal-card" data-id="${deal.id}" data-category="${deal.category}" style="animation-delay: ${index * 0.1}s" onclick="openModal('${deal.id}')">
            <div class="deal-image-container">
              <img src="${deal.image}" alt="${deal.name}" class="deal-image">
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
              <p class="deal-description" style="display: none;">${deal.description}</p>
            </div>
          </div>
        `;
      });
    }

    dealsHTML += `
        </div>
        <div class="pagination">
          <a href="#" onclick="goToPage(1)">1</a>
          <a href="#" onclick="goToPage(2)">2</a>
          <a href="#" onclick="goToPage(3)">3</a>
          <!-- Add more pagination links as needed -->
        </div>
        <div style="text-align: center;">
          <a href="/admin" class="back-link">
            <i class="fas fa-arrow-left"></i>
            Back to Dashboard
          </a>
        </div>
        <div id="deal-modal" style="display: none;">
          <div class="modal-content">
            <span class="close" onclick="closeModal()">&times;</span>
            <h2 class="modal-title"></h2>
            <img src="" alt="" class="modal-image">
            <p class="modal-price"></p>
            <p class="modal-description"></p>
          </div>
        </div>
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
