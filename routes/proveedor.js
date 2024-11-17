import express from 'express'
import { db } from '../firebase.js'
import multer from 'multer'

const router = express.Router()
const supplierCollection = db.collection('proveedor')
const supplierOrderCollection = db.collection('ordenProvedor')

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
    const { nombreProveedor, producto, categoria, precioCompra, numeroContacto, Tipo, correo } = req.body;

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
            correo,
            imagenProUrl,
        })

        res.status(201).json({ message: 'Proveedor creado exitosamente', imagenProUrl })
    } catch (error) {
        res.status(500).json({ error: 'Error al crear el proveedor', details: error.message })
    }
})

router.post('/crearordenproveedor', async (req, res) => {
    const { nombreProducto, categoria, precioPedido, cantidad, unidad, nombreProveedor, correoProveedor } = req.body

    if (!nombreProveedor) {
        return res.status(400).json({ error: 'El nombre del proveedor es obligatorio.' })
    }

    if (!correoProveedor) {
        return res.status(400).json({ error: 'El correo del proveedor es obligatorio.' })
    }

    try {
        const callProveedor = await supplierCollection.where('nombreProveedor', '==', nombreProveedor).where('producto', '==', nombreProducto).get()

        if (callProveedor.empty) {
            return res.status(404).json({ error: 'El proveedor no ofrece este producto.' })
        }

        await supplierOrderCollection.add({
            nombreProducto,
            categoria,
            cantidad: parseInt(cantidad),
            unidad,
            nombreProveedor,
            correoProveedor,
        })

        res.status(201).json({ message: 'Orden creada exitosamente' })
    } catch (error) {
        res.status(500).json({ error: 'Error al crear la orden', details: error.message })
    }
})

router.get('/proveedores/producto', async (req, res) => {
    const { producto } = req.query

    try {
        const callProveedores = await supplierCollection.where('producto', '==', producto).get()

        if (callProveedores.empty) {
            return res.status(404).json({ error: 'No se encontraron proveedores para este producto.' })
        }

        const proveedores = callProveedores.docs.map(doc => ({
            nombreProveedor: doc.data().nombreProveedor,
            correo: doc.data().correo
        }))

        res.status(200).json(proveedores)
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener los proveedores', details: error.message })
    }
})

router.get('/proveedores', async (req, res) => {
    try {
        const callSupplier = await supplierCollection.get()

        if (callSupplier.empty) {
            return res.status(404).json({ error: 'No se encontraron proveedores' })
        }

        const proveedores = []

        for (const doc of callSupplier.docs) {
            const data = doc.data()

            const callOrders = await supplierOrderCollection.where('nombreProducto', '==', data.producto).where('nombreProveedor', '==', data.nombreProveedor).get()

            let cantidadEnCamino = 0
            if (!callOrders.empty) {
                cantidadEnCamino = callOrders.docs.reduce((acc, orderDoc) => {
                    const orderData = orderDoc.data()
                    return acc + (parseInt(orderData.cantidad) || 0)
                }, 0)
            }

            proveedores.push({
                nombreProveedor: data.nombreProveedor,
                producto: data.producto,
                numeroContacto: data.numeroContacto,
                correo: data.correo,
                Tipo: data.Tipo,
                enCamino: cantidadEnCamino,
            })
        }

        res.status(200).json(proveedores)
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener los proveedores', details: error.message })
    }
})

export default router
