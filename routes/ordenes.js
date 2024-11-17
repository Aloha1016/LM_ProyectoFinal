import express from 'express'
import { db } from '../firebase.js'

const router = express.Router()
const ordersCollection = db.collection('ordenes')

const dateRegex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

router.post('/crearorden', async (req, res) => {
    const { ordenId, nombreProducto, productoId, categoria, precioPedido, cantidad, unidad, precioPieza, fechaEntrega } = req.body

    try {
        const findOrder = await ordersCollection.where('ordenId', '==', ordenId).get()

        if (!findOrder.empty) {
            return res.status(400).json({ error: 'El ID de la orden ya existe' })
        }

        if (!dateRegex.test(fechaEntrega)) {
            return res.status(400).json({ error: 'La fecha debe tener el formato YYYY-MM-DD.' })
        }

        const fechaEntregaDate = new Date(fechaEntrega)
        const fechaActual = new Date()

        if (fechaEntregaDate <= fechaActual) {
            return res.status(400).json({ error: 'La fecha de entrega debe ser mayor a la fecha actual.' })
        }

        await ordersCollection.add({
            ordenId,
            nombreProducto,
            productoId,
            categoria,
            precioPedido: parseFloat(precioPedido),
            cantidad: parseInt(cantidad),
            unidad,
            precioPieza: parseFloat(precioPieza),
            fechaEntrega,
            estado: 'En camino',
        })

        res.status(201).json({ message: 'Orden creada exitosamente' })
    } catch (error) {
        res.status(500).json({ error: 'Error al crear la orden', details: error.message })
    }
})

router.get('/ordenes', async (req, res) => {
    try {
        const callOrders = await ordersCollection.get()

        if (callOrders.empty) {
            return res.status(404).json({ error: 'No se encontraron ordenes' })
        }

        const fechaActual = new Date()
        const ordenes = callOrders.docs.map(doc => {
            const data = doc.data()

            if (data.estado === 'En camino' && new Date(data.fechaEntrega) < fechaActual) {
                data.estado = 'Retrasado'
            }

            return {
                nombreProducto: data.nombreProducto,
                precioPedido: data.precioPedido,
                cantidad: `${data.cantidad} ${data.unidad}`,
                ordenId: data.ordenId,
                fechaEntrega: data.fechaEntrega,
                estado: data.estado,
            }
        })

        res.status(200).json(ordenes)
    } catch (error) {
        res.status(500).json({ error: "Error al obtener las ordenes", details: error.message })
    }
})

router.put('/ordenes/:id/devolver', async (req, res) => {
    const { id } = req.params

    try {
        const order = await ordersCollection.where('ordenId', '==', id).get()

        if (order.empty) {
            return res.status(404).json({ error: 'Orden no encontrada' })
        }

        const orderData = order.docs[0].data()
        const docRef = order.docs[0].ref

        if (orderData.estado !== 'Confirmado') {
            return res.status(400).json({ error: 'Solo se puede devolver un pedido que ya haya sido entregado.' })
        }

        await docRef.update({ estado: 'Devuelto' })

        res.status(200).json({ message: 'Estado actualizado a Devuelto' })
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar el estado', details: error.message })
    }
})

router.put('/ordenes/:id/confirmar', async (req, res) => {
    const { id } = req.params

    try {
        const order = await ordersCollection.where('ordenId', '==', id).get()

        if (order.empty) {
            return res.status(404).json({ error: 'Orden no encontrada' })
        }

        const orderData = order.docs[0].data()
        const docRef = order.docs[0].ref

        if (orderData.estado === 'Devuelto') {
            return res.status(400).json({ error: 'No se puede confirmar un pedido que ha sido devuelto.' })
        }

        await docRef.update({ estado: 'Confirmado' })

        res.status(200).json({ message: 'Estado actualizado a Confirmado' })
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar el estado', details: error.message })
    }
})

export default router;
