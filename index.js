import express from 'express'
import bodyParser from 'body-parser'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'

import duenosRoutes from './routes/duenos.js'
import productRoutes from './routes/producto.js'
import supplierRouter from './routes/proveedor.js'
import ordersRouter from './routes/ordenes.js'
import storeRouter from './routes/tiendas.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

// Configurar CORS (permitir todos los orígenes)
app.use(cors())

// Otras configuraciones
app.use(bodyParser.json())

// Servir la carpeta de archivos estáticos para el frontend
app.use(express.static(path.join(__dirname, '../LM_PF_Front'))) // Ajusta la ruta según tu estructura

// Servir imágenes subidas
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))
app.use('/uploads/tienda', express.static(path.join(__dirname, 'uploads/tienda')))

// Rutas de API
app.use('/api/dueno', duenosRoutes)
app.use('/api/producto', productRoutes)
app.use('/api/proveedor', supplierRouter)
app.use('/api/orden', ordersRouter)
app.use('/api/tienda', storeRouter)

const PORT = process.env.PORT || 4000

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`)
})
