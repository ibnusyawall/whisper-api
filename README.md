<div align="center">
  <img src="logo.svg" alt="Whisper API Logo" width="120" height="120">
  
  # Whisper API
  
  **A RESTful WhatsApp messaging API built with Express.js and Baileys library for seamless WhatsApp integration.**
  
  ⚡ *Think of it as a developer-friendly WhatsApp messaging gateway — similar to how Stripe provides APIs for payments.*
 
  ![Last Commit](https://img.shields.io/github/last-commit/ibnusyawall/whisper-api)
  ![Stars](https://img.shields.io/github/stars/ibnusyawall/whisper-api)
  [![Node.js](https://img.shields.io/badge/Node.js-v20+-green)](https://nodejs.org/en)
  [![Express.js](https://img.shields.io/badge/Express.js-v5.1+-blue)](https://expressjs.com/)
  [![Baileys](https://img.shields.io/badge/Baileys-v6.7+-purple)](https://github.com/WhiskeySockets/Baileys/)
  [![License](https://img.shields.io/badge/License-MIT-yellow)](https://github.com/ibnusyawall/whisper-api/blob/main/LICENSE)
  [![CodeFactor](https://www.codefactor.io/repository/github/ibnusyawall/whisper-api/badge)](https://www.codefactor.io/repository/github/ibnusyawall/whisper-api)
</div>

## Features

- 🏓 **Ping/Pong** - Health check endpoint
- 📊 **Status Check** - WhatsApp connection status monitoring
- 📨 **Send Message** - Send text messages to personal chats
- 👥 **Send Group Message** - Send messages to WhatsApp groups
- 🔗 **Webhooks** - Real-time event notifications via HTTP webhooks
- 🏢 **Multi-Instance** - Manage multiple WhatsApp instances simultaneously
- 🔌 **Plugin Management** - Per-instance plugin configuration and control
- 📋 **Logging** - Comprehensive logging for all activities
- 🔧 **Modular Structure** - Clean, maintainable, and scalable code structure

## Use Cases

Whisper API is designed to help developers integrate WhatsApp messaging into their systems without directly managing WhatsApp Web sessions.

Common use cases include:

- WhatsApp notification systems
- Customer support automation
- CRM integrations
- AI agents and chat automation
- SaaS messaging gateways
- Internal automation tools

## Installation

1. Clone the repository:
```bash
git clone https://github.com/ibnusyawall/whisper-api.git
cd whisper-api
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

4. Configure your `.env` file with the required variables (see Environment Variables section below).

5. Set up the database (MongoDB with Prisma):
```bash
# Generate Prisma client
npx prisma generate

# Push database schema to MongoDB
npx prisma db push
```

6. Start the server:
```bash
# Development
npm run dev

# Production
npm start
```

## API Endpoints

For comprehensive API documentation, including all available endpoints, request/response examples, and testing collections, please refer to:

📚 **[API Collections Documentation](api-collections/README.md)**

The API supports multiple operational modes:
- **Single Instance Mode**: Legacy endpoints for single WhatsApp instance
- **Multi-Instance Mode**: Advanced endpoints for managing multiple WhatsApp instances
- **Hybrid Mode**: Both single and multi-instance endpoints available simultaneously

Key endpoint categories:
- 🌐 **Global Endpoints**: Mode information and system status
- 🔀 **Single Instance (Legacy)**: Basic WhatsApp messaging functionality
- 🏢 **Multi-Instance Management**: Instance creation, monitoring, messaging, webhook management, and plugin configuration

## First Time Setup

### Single Instance Mode Setup
1. Ensure `WHATSAPP_MODE=single` or `WHATSAPP_MODE=both` in your `.env` file
2. Start the server: `npm start` or `npm run dev`
3. Scan the QR code displayed in the terminal using WhatsApp on your phone
4. Check connection status: `GET /api/v1/status`
5. Start sending messages using legacy endpoints

### Multi-Instance Mode Setup
1. Ensure `WHATSAPP_MODE=multi` or `WHATSAPP_MODE=both` in your `.env` file
2. Configure `DATABASE_URL` in your `.env` file
3. Set up the database: `npx prisma generate && npx prisma db push`
4. Start the server: `npm start` or `npm run dev`
5. Create a WhatsApp instance: `POST /api/v1/instances`
6. Get the QR code: `GET /api/v1/instances/{phone}/qr`
7. Scan the QR code with WhatsApp on your phone
8. Check instance status: `GET /api/v1/instances/{phone}/status`
9. Start sending messages using multi-instance endpoints

### Quick Test Commands
```bash
# Check current mode
curl http://localhost:3000/api/v1/mode

# Create instance (multi-instance mode)
curl -X POST http://localhost:3000/api/v1/instances \
  -H "Content-Type: application/json" \
  -d '{"phone":"628123456789","name":"My Instance"}'

# Get QR code (multi-instance mode)
curl http://localhost:3000/api/v1/instances/628123456789/qr
```

## Project Structure

```
src/
├── app.js                 # Main application file
├── config/                # Configuration files
│   └── mode.config.js     # WhatsApp mode configuration
├── controllers/           # Request handlers
│   ├── instance.controller.js # Multi-instance management
│   ├── log.controller.js     # Logging handler
│   ├── message.controller.js # Message sending handler
│   ├── mode.controller.js    # Mode information handler
│   ├── ping.controller.js    # Health check handler
│   ├── status.controller.js  # Status check handler
│   └── webhook.controller.js # Webhook management
├── core/                  # Core system components
│   └── plugin-manager.core.js # Plugin management system
├── database/              # Database connection and setup
│   └── prisma.js         # Prisma client configuration
├── plugins/              # Optional features as plugins
│   ├── admin-commands.plugin.js
│   ├── anti-mention.plugin.js
│   ├── eval-command.plugin.js
│   └── welcome-group.plugin.js
├── routes/               # API route definitions
│   └── index.js         # Main routing configuration
├── services/             # Business logic and services
│   ├── instanceLogService.js        # Instance logging service
│   ├── instanceService.js           # Instance management service
│   ├── messageService.js           # Message handling service
│   ├── webhookService.js           # Webhook management service
│   ├── whatsapp.service.js         # Legacy WhatsApp service
│   └── whatsappInstanceManager.service.js # Multi-instance manager
└── utils/                # Utility functions
    └── logger.js         # Winston logger utility

api-collections/          # API testing collections
├── global/              # Global endpoint tests
├── multi-instance/      # Multi-instance endpoint tests
├── single-instance/     # Legacy endpoint tests
├── postman_collection.json # Postman collection
└── README.md           # API documentation

auth/                    # Baileys authentication files
logs/                    # Application logs
prisma/                  # Prisma database schema
├── schema.prisma       # Database schema definition
tests/                   # Test files
├── database tests and setup
```

## Environment Variables

Configure the following environment variables in your `.env` file:

### Required Variables

```bash
# Server Configuration
PORT=3000                    # Port number for the server (default: 3000)
NODE_ENV=production          # Environment mode: development, production

# Database Configuration (Required for Multi-Instance Mode)
DATABASE_URL="mongodb://localhost:27017/whisper-api"
                            # MongoDB connection string for Prisma
                            # Format: mongodb://[username:password@]host[:port]/database
                            # Example: mongodb://user:pass@localhost:27017/whisper-api

# WhatsApp Configuration
WHATSAPP_MODE=multi         # Operational mode: single, multi, both
                            # - single: Legacy single-instance only
                            # - multi: Multi-instance management only (default)
                            # - both: Hybrid mode

# Logging Configuration
LOG_LEVEL=info              # Logging level: error, warn, info, debug
DEBUG=true                  # Enable verbose debug output: true, false
```

### Environment Variable Details

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | Server port number | `3000` | No |
| `NODE_ENV` | Application environment | `production` | No |
| `DATABASE_URL` | MongoDB connection string | - | Yes (for multi-instance) |
| `WHATSAPP_MODE` | Operational mode | `multi` | No |
| `LOG_LEVEL` | Logging verbosity | `info` | No |
| `DEBUG` | Debug mode toggle | `false` | No |

### Mode Configuration

The `WHATSAPP_MODE` variable determines which endpoints are available:

- **`single`**: Only legacy single-instance endpoints (`/api/v1/ping`, `/api/v1/message`, etc.)
- **`multi`**: Only multi-instance endpoints (`/api/v1/instances/*`, webhooks, etc.)
- **`both`**: All endpoints available (recommended for development)

### Database Setup

For multi-instance functionality, a MongoDB database with **replica set support** is required. This is essential for Prisma to handle transactions and ensure data consistency. You can either use a cloud provider that supports replica sets or set one up locally using Docker.

**Important Note:** Standard single-node MongoDB instances (like the default `mongo:latest` Docker image) will **not** work for multi-instance mode due to the lack of replica set functionality.

#### Option 1: MongoDB Atlas (Recommended)

MongoDB Atlas provides free-tier clusters with replica sets enabled by default. This is the easiest and most reliable way to get started.

1.  **Create a free cluster** on [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
2.  **Get your connection string** (e.g., `mongodb+srv://user:pass@cluster.mongodb.net/whisper-api`).
3.  **Update `DATABASE_URL`** in your `.env` file.

#### Option 2: Local Docker with Replica Set

You can run a local MongoDB replica set using the provided Docker Compose file. This is ideal for development and testing.

1.  **Ensure you have Docker and Docker Compose installed.**
2.  **Run the following command** to start a single-node replica set:

    ```bash
    docker-compose up -d
    ```

3.  **Update your `DATABASE_URL`** to use the local replica set:

    ```bash
    DATABASE_URL="mongodb://localhost:27017/whisper-api?replicaSet=rs0&directConnection=true"
    ```

4.  **Stop the replica set** when you're done:

    ```bash
    docker-compose down
    ```

This setup provides a complete, isolated environment for running the database with the required replica set configuration.

## Phone Number Format

- Format: `628123456789` (with country code 62 for Indonesia)
- Numbers starting with `0` will be automatically formatted
- Example: `08123456789` → `628123456789`

## Group ID Format

- Group IDs typically end with `@g.us`
- Example: `120363042123456789@g.us`
- Can be obtained from WhatsApp logs or other tools

## Logging

- Logs are stored in the `logs/` directory
- `app.log` - all application logs
- `error.log` - error logs only
- Automatic log rotation (5MB per file, max 10 files)

## Error Handling

The API returns standardized error responses:

```json
{
  "success": false,
  "error": "Error type",
  "message": "Detailed error message",
  "timestamp": "2025-07-13T10:00:00.000Z"
}
```

## Deployment

### Railway
```bash
# Install Railway CLI
npm install -g @railway/cli

# Deploy
railway login
railway init
railway up
```

### Vercel
```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod
```

### Render
1. Connect your GitHub repository
2. Set build command: `npm install`
3. Set start command: `npm start`
4. Deploy

### VPS/Traditional Hosting
```bash
# Using PM2 for process management
npm install -g pm2
pm2 start src/app.js --name whisper-api
pm2 startup
pm2 save
```

## Usage Examples

### Using cURL

```bash
# Health check
curl -X GET http://localhost:3000/api/v1/ping

# Send message
curl -X POST http://localhost:3000/api/v1/message \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"628123456789","message":"Hello World!"}'

# Check status
curl -X GET http://localhost:3000/api/v1/status
```

### Using JavaScript/Node.js

```javascript
const axios = require('axios');

// Send message
const sendMessage = async () => {
  try {
    const response = await axios.post('http://localhost:3000/api/v1/message', {
      phoneNumber: '628123456789',
      message: 'Hello from Whisper API!'
    });
    console.log(response.data);
  } catch (error) {
    console.error(error.response.data);
  }
};
```

## Notes

### General Notes
- The API supports three operational modes: `single`, `multi`, and `both` (hybrid)
- Check current mode with `GET /api/v1/mode` before using specific endpoints
- Keep the server running to maintain WhatsApp connections
- All API responses follow a consistent format with `success`, `data`, and `message` fields

### Single Instance Mode
- QR code appears in terminal on first run or after logout
- WhatsApp session is stored in the `auth/` directory
- Don't delete the `auth/` folder to maintain session
- Service will automatically reconnect if disconnected
- Only one WhatsApp connection can be active at a time

### Multi-Instance Mode
- Requires MongoDB database connection for instance management
- Each instance has its own authentication state stored in the database
- QR codes are retrieved via API endpoints (`/api/v1/instances/{phone}/qr`)
- Multiple WhatsApp instances can run simultaneously
- Instance data persists between server restarts
- Webhooks can be configured per instance for real-time notifications

### Webhooks
- Only available in multi-instance mode
- Configure webhooks per instance for different events
- Supported events: `message_received`, `message_sent`, `connection_status`, etc.
- Webhook URLs should be publicly accessible HTTPS endpoints

### Database
- MongoDB is required for multi-instance functionality
- Prisma ORM handles database operations
- Run `npx prisma db push` to sync schema changes
- Database stores instances, webhooks, messages, and logs

## Common Issues

### 1. QR Code Issues

#### Single Instance Mode
- QR code not appearing in terminal: Delete the `auth/` folder and restart the application
- QR code expired: Restart the server to generate a new QR code
- Authentication failed: Clear the `auth/` folder and scan a fresh QR code

#### Multi-Instance Mode
- QR code not generated: Check if instance exists with `GET /api/v1/instances/{phone}/status`
- QR code endpoint returns error: Ensure the instance is in `pending` or `disconnected` state
- QR code expired: Call `POST /api/v1/instances/{phone}/restart` to generate a new one

### 2. Connection and Message Issues

#### Single Instance Mode
- Connection lost: Check status with `GET /api/v1/status` and restart if needed
- Messages not sending: Verify connection status and phone number format (628xxxxxxxxx)
- Service disconnected: Check logs and restart the application

#### Multi-Instance Mode
- Instance not connecting: Check instance status with `GET /api/v1/instances/{phone}/status`
- Messages failing: Ensure instance is in `connected` state before sending
- Multiple instances failing: Check database connection and MongoDB availability
- Webhook not receiving events: Verify webhook URL is accessible and uses HTTPS

### 3. Database Issues (Multi-Instance Mode)
- Connection failed: Verify `DATABASE_URL` in `.env` file
- Schema out of sync: Run `npx prisma db push` to update database schema
- Migration errors: Run `npx prisma generate` followed by `npx prisma db push`
- MongoDB not accessible: Ensure MongoDB is running and accessible at the specified URL

### 4. Server and Configuration Issues
- Port already in use: Change `PORT` in `.env` or kill existing processes with `lsof -ti:3000 | xargs kill -9`
- Wrong operational mode: Check `WHATSAPP_MODE` in `.env` and restart server
- Environment variables not loaded: Ensure `.env` file exists and is properly formatted
- Service instability: Check logs in `logs/` directory for detailed error information

### 5. Performance Issues
- High memory usage: Monitor instance count and consider restarting instances periodically
- Slow response times: Check database performance and consider adding indexes
- Rate limiting: WhatsApp may limit message sending; implement delays between messages
- Log file size: Configure log rotation or clear old logs from `logs/` directory

### 6. Development and Testing Issues
- API endpoints not working: Verify the correct mode is set and endpoints are available
- CORS errors: Configure CORS settings if accessing from browser applications
- Authentication errors: Ensure proper headers and request format as per API documentation
- Webhook testing: Use tools like ngrok for local webhook testing with public HTTPS URLs

## Use Cases

Whisper API is designed to help developers integrate WhatsApp messaging into their systems without directly managing WhatsApp Web sessions.

Common use cases include:

- WhatsApp notification systems
- Customer support automation
- CRM integrations
- AI agents and chat automation
- SaaS messaging gateways
- Internal automation tools

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Disclaimer

This project is for educational and development purposes. Please ensure you comply with WhatsApp's Terms of Service when using this API.

## Support

If you found this project helpful, please give it a ⭐ star!

For issues and questions, please create an issue in the GitHub repository.
