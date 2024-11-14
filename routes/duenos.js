import express from 'express'
import bcrypt from 'bcryptjs'
import admin from 'firebase-admin'
import serviceAccount from '../config/lenguajesad.json' with { type: 'json'}
import { generateToken, verifyToken } from './conexion.js'

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
})

const router = express.Router()
const db = admin.firestore()
const duenosCollection = db.collection('duenos')

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]

    if (!token) {
        return res.status(401).json({
            message: 'No Autorizado'
        })
    }

    try {
        const user = verifyToken(token)
        req.user = user
        next()
    } catch (error) {
        res.sendStatus(403)
    }
}

router.post('/login', async (req, res) => {
    const {correo, password} = req.body
    const findCorreo = await duenosCollection.where('correo', '==', correo).get()

    if(findCorreo.empty) {
        return res.status(400).json({
            error: 'El correo no existe'
        })
    }

    const userDoc = findCorreo.docs[0]
    const user = userDoc.data()

    const validPassword = await bcrypt.compare(password, user.password)

    if(!validPassword) {
        return res.status(400).json({
            error: 'Contraseña Incorrecta!'
        })
    }

    const token = generateToken({
        id: userDoc.id,
        correo: user.correo
    })

    res.status(201).json({
        token
    })
})

router.post('/creardueno', async (req, res) => {
    const { nombre, correo, password } = req.body

    const findCorreo = await duenosCollection.where('correo', '==', correo).get()

    if(!findCorreo.empty) {
        return res.status(400).json({
            error: 'El correo ya existe'
        })
    }

    const passwHashed = await bcrypt.hash(password, 10)

    await duenosCollection.add({
        nombre,
        correo,
        password: passwHashed
    })

    res.status(201).json({
        message: 'success'
    })
})

export default router