import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

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

// Read products from file
async function readProducts() {
  try {
    const data = await fs.readFile(productsFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading products:', error);
    return [];
  }
}

// Write products to file
async function writeProducts(products) {
  try {
    await fs.writeFile(productsFile, JSON.stringify(products, null, 2));
  } catch (error) {
    console.error('Error writing products:', error);
  }
}

// Read analytics from file
async function readAnalytics() {
  try {
    const data = await fs.readFile(analyticsFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading analytics:', error);
    return { queries: [], traffic: 0, productViews: {} };
  }
}

// Write analytics to file
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
  analytics.queries.push({ chatId, query, timestamp: new Date(), status: 'Pending' });
  analytics.traffic += 1;
  await writeAnalytics(analytics);
}

// Track product views
async function trackProductView(productId) {
  const analytics = await readAnalytics();

  // Update product views
  if (!analytics.productViews[productId]) {
    analytics.productViews[productId] = 0;
  }
  analytics.productViews[productId] += 1;

  // Update query status to "Success" for the corresponding product
  analytics.queries = analytics.queries.map(query => {
    if (query.query.includes(productId)) {
      query.status = 'Success';
    }
    return query;
  });

  await writeAnalytics(analytics);
}

// Telegram Bot Handlers
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Welcome! Please enter a product name to search.');
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

  try {
    // Track product view
    await trackProductView(productId);

    // Read products from the JSON file
    const products = await readProducts();

    // Find the selected product by ID
    const product = products.find(p => p.id.toString() === productId);
    if (!product) {
      bot.sendMessage(chatId, 'Product not found.');
      return;
    }

    // Create the HTML message for the product
    const htmlMessage = `
      <b>🎧 ${product.name}</b>
      
      ${product.description}
      
      <b>💰 Price:</b> $${product.price.toFixed(2)}
      <b>💵 MRP:</b> <s>$${product.mrp.toFixed(2)}</s>
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
      await bot.sendPhoto(chatId, product.image, {
        caption: htmlMessage,
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard
      });
    } else {
      await bot.sendMessage(chatId, htmlMessage, {
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard
      });
    }
  } catch (error) {
    console.error('Error in callback_query handler:', error);
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

// Serve Admin Panel HTML
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
        body {
          font-family: Arial, sans-serif;
          background: #f4f4f4;
          padding: 20px;
        }
        .card {
          margin-bottom: 20px;
          border: none;
          border-radius: 10px;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        }
        .card-body {
          padding: 20px;
        }
        .table {
          margin-top: 20px;
        }
        .badge {
          padding: 5px 10px;
          border-radius: 5px;
        }
        .badge.bg-warning {
          background-color: #ffc107;
        }
        .badge.bg-success {
          background-color: #28a745;
        }
        .chat-window {
          height: 300px;
          overflow-y: auto;
          border: 1px solid #ddd;
          padding: 10px;
          border-radius: 10px;
          background: #fff;
        }
        .chat-message {
          margin-bottom: 10px;
        }
        .chat-message.admin {
          text-align: right;
          color: #007bff;
        }
        .chat-message.user {
          text-align: left;
          color: #333;
        }
      </style>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js"></script>
    </head>
    <body>
      <div class="container mt-5">
        <h1 class="mb-4">Admin Dashboard</h1>

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
        <h2 class="mt-4">Query Status</h2>
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
        <h2 class="mt-4">Chat with User</h2>
        <div class="chat-window" id="chatWindow">
          <!-- Chat messages will be displayed here -->
        </div>
        <div class="input-group mt-3">
          <input type="text" id="chatInput" class="form-control" placeholder="Type your message...">
          <button class="btn btn-primary" id="sendMessageBtn">Send</button>
        </div>

        <!-- Product Views -->
        <h2 class="mt-4">Product Views</h2>
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
        <h2 class="mt-4">Realtime Traffic Chart</h2>
        <canvas id="realtimeTrafficChart"></canvas>

        <a href="/admin/add-product" class="btn btn-primary mt-4">Add Product</a>
      </div>

      <script>
        let trafficChart = null; // Store the chart instance
        let currentChatId = null; // Store the current chat ID

        async function fetchAnalytics() {
          try {
            const response = await axios.get('/api/analytics');
            const analytics = response.data;

            // Update total products
            const productsResponse = await axios.get('/api/products');
            document.getElementById('totalProducts').textContent = productsResponse.data.length;

            // Update most viewed product
            let mostViewedProductId = null;
            if (Object.keys(analytics.productViews).length > 0) {
              mostViewedProductId = Object.keys(analytics.productViews).reduce((a, b) => 
                analytics.productViews[a] > analytics.productViews[b] ? a : b
              );
            }
            const mostViewedProduct = productsResponse.data.find(p => p.id.toString() === mostViewedProductId);
            document.getElementById('mostViewedProduct').textContent = mostViewedProduct ? mostViewedProduct.name : 'N/A';

            // Update realtime traffic
            document.getElementById('realtimeTraffic').textContent = analytics.traffic;

            // Update query status table
            const queryTable = document.getElementById('queryTable');
            queryTable.innerHTML = analytics.queries.map(query => `
              <tr>
                <td>${query.chatId}</td>
                <td>${query.query}</td>
                <td>${new Date(query.timestamp).toLocaleString()}</td>
                <td><span class="badge ${query.status === 'Pending' ? 'bg-warning' : 'bg-success'}">${query.status}</span></td>
                <td><button class="btn btn-sm btn-primary" onclick="openChat(${query.chatId})">Chat</button></td>
              </tr>
            `).join('');

            // Update product views table
            const productViewsTable = document.getElementById('productViewsTable');
            productViewsTable.innerHTML = Object.entries(analytics.productViews).map(([id, views]) => `
              <tr>
                <td>${id}</td>
                <td>${views}</td>
              </tr>
            `).join('');

            // Update realtime traffic chart
            const ctx = document.getElementById('realtimeTrafficChart').getContext('2d');

            // Destroy existing chart instance
            if (trafficChart) {
              trafficChart.destroy();
            }

            // Create new chart instance
            trafficChart = new Chart(ctx, {
              type: 'line',
              data: {
                labels: analytics.queries.map((_, index) => `Query ${index + 1}`),
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
              chatWindow.innerHTML += `<div class="chat-message admin">${message}</div>`;
              document.getElementById('chatInput').value = '';
              chatWindow.scrollTop = chatWindow.scrollHeight; // Scroll to the bottom
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
          body {
            font-family: Arial, sans-serif;
            background: #f4f4f4;
            padding: 20px;
          }
          .product-card {
            background: white;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
          }
          .product-card img {
            max-width: 100%;
            border-radius: 10px;
          }
        </style>
      </head>
      <body>
        <div class="container mt-5">
          <div class="product-card">
            <h1>${product.name}</h1>
            <p>${product.description}</p>
            <p>Price: $${product.price.toFixed(2)}</p>
            <p>MRP: <s>$${product.mrp.toFixed(2)}</s></p>
            <p>Rating: ${product.rating} ⭐</p>
            <a href="${product.buyLink}" class="btn btn-primary">Order Now</a>
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

console.log('Bot is running...');
