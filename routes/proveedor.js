import express from 'express'
import { db } from '../firebase.js'
import multer from 'multer'

const router = express.Router()
const supplierCollection = db.collection('proveedor')

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/proveedor/')
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${file.originalname}`
        cb(null, uniqueSuffix)
    },
})

const upload = multer({ storage })

router.post('/crearproveedor', upload.single('imagen'), async (req, res) => {
    const { nombreProveedor, producto, categoria, precioCompra, numeroContacto, Tipo } = req.body;

    const tiposPermitidos = ['No acepta devolucion', 'Acepta devolucion']
    if (!tiposPermitidos.includes(Tipo)) {
        return res.status(400).json({ error: 'Tipo no válido.' })
    }

    try {
        let imagenProUrl = null

        if (req.file) {
            imagenProUrl = `${req.protocol}://${req.get('host')}/uploads/proveedor/${req.file.filename}`
        }

        await supplierCollection.add({
            nombreProveedor,
            producto,
            categoria,
            precioCompra: parseFloat(precioCompra),
            numeroContacto,
            Tipo,
            imagenProUrl,
        })

        res.status(201).json({ message: 'Proveedor creado exitosamente', imagenProUrl })
    } catch (error) {
        res.status(500).json({ error: 'Error al crear el proveedor', details: error.message })
    }
})

export default router
