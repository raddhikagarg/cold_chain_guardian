require('dotenv').config({ quiet: true })

const express = require('express')
const cors = require('cors')
const healthRoutes = require('./routes/healthRoutes')
const shipmentRoutes = require('./routes/shipmentRoutes')
const deviceRoutes = require('./routes/deviceRoutes')
const readingRoutes = require('./routes/readingRoutes')
const alertRoutes = require('./routes/alertRoutes')
const dashboardRoutes = require('./routes/dashboardRoutes')
const notFound = require('./middleware/notFound')
const errorHandler = require('./middleware/errorHandler')

const app = express()

// The Vite frontend runs on port 5173 during development.
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173'

// Allow the frontend to call this API and parse JSON request bodies.
app.use(cors({ origin: CLIENT_ORIGIN }))
app.use(express.json())

// Health checks live under /api so future resources can follow the same pattern.
app.use('/api', healthRoutes)
app.use('/api/shipments', shipmentRoutes)
app.use('/api/devices', deviceRoutes)
app.use('/api/readings', readingRoutes)
app.use('/api/alerts', alertRoutes)
app.use('/api/dashboard', dashboardRoutes)

// Shared 404 and error envelopes. These must stay last.
app.use(notFound)
app.use(errorHandler)

module.exports = app
