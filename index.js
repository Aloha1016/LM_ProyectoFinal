import express from 'express'
import bodyParser from 'body-parser'
import cors from 'cors'

const app = express()
const corsOptions = {
    origin: '*',
    optionsSuccessStatus: 200
}
app.use(cors(corsOptions))
app.use(bodyParser.json())


const PORT = process.env.PORT || 4000

app.listen(PORT, () => {
    console.log(`Servidor Corriendo en ${PORT}`)
})