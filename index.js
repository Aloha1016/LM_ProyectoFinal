import express from 'express'
import bodyParser from 'body-parser'
import cors from 'cors'
import duenosRoutes from './routes/duenos.js'

const app = express()
const corsOptions = {
    origin: '*',
    optionsSuccessStatus: 200
}
app.use(cors(corsOptions))
app.use(bodyParser.json())

app.use('/api/dueno', duenosRoutes)

const PORT = process.env.PORT || 4000

app.listen(PORT, () => {
    console.log(`Servidor Corriendo en ${PORT}`)
})