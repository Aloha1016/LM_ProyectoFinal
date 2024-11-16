import express from 'express'
import bodyParser from 'body-parser'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import duenosRoutes from './routes/duenos.js'
import productRoutes from './routes/producto.js'
import supplierRouter from './routes/proveedor.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const corsOptions = {
  origin: '*',
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions))
app.use(bodyParser.json())

app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

// Rutas
app.use('/api/dueno', duenosRoutes)
app.use('/api/producto', productRoutes)
app.use('/api/proveedor', supplierRouter)

const PORT = process.env.PORT || 4000

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`)
})
