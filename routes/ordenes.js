import express from 'express'
import { db } from '../firebase.js'
import { productCollection } from './producto.js'
import { v4 as uuidv4 } from 'uuid'
import cron from 'node-cron'

const router = express.Router()
const ordersCollection = db.collection('ordenes')

const dateRegex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

cron.schedule('10 22 * * *', async () => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Ignorar la hora, solo comparar fechas

        const ordersSnapshot = await ordersCollection.where('estado', '==', 'En camino').get();
        if (ordersSnapshot.empty) {
            console.log('No hay órdenes para procesar.');
            return;
        }

        const batch = db.batch();

        ordersSnapshot.forEach(doc => {
            const orderData = doc.data();
            const entregaDate = new Date(orderData.fechaEntrega);

            if (entregaDate < today) {
                // Actualizar estado a "Retrasado"
                const docRef = doc.ref;
                batch.update(docRef, { estado: 'Retrasado' });
            }
        });

        await batch.commit();
        console.log('Órdenes actualizadas a Retrasado');
    } catch (error) {
        console.error('Error al actualizar órdenes:', error.message);
    }
});

router.post('/crearorden', async (req, res) => {
    const { ordenId, nombreProducto, productoId, categoria, precioPedido, cantidad, unidad, precioPieza, fechaEntrega } = req.body

    try {
        const ordenId = uuidv4();

        // Verificar que el producto existe
        const findProduct = await productCollection.where('nombre', '==', nombreProducto).get()
        if (findProduct.empty) {
            return res.status(400).json({ error: 'El producto no existe' })
        }

        // Validación del formato de la fecha
        if (!dateRegex.test(fechaEntrega)) {
            return res.status(400).json({ error: 'La fecha debe tener el formato YYYY-MM-DD.' })
        }

        const fechaEntregaDate = new Date(fechaEntrega)
        const fechaActual = new Date()

        if (fechaEntregaDate <= fechaActual) {
            return res.status(400).json({ error: 'La fecha de entrega debe ser mayor a la fecha actual.' })
        }

        // Crear la orden si todas las validaciones pasan
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
        const { page = 1, limit = 6, estado = '', sortField = 'fechaEntrega', sortOrder = 'asc' } = req.query;
        const parsedPage = parseInt(page);
        const parsedLimit = parseInt(limit);

        if (isNaN(parsedPage) || isNaN(parsedLimit) || parsedPage < 1 || parsedLimit < 1) {
            return res.status(400).json({ error: 'Parámetros inválidos para página o límite' });
        }

        const callOrders = await ordersCollection.get();
        if (callOrders.empty) {
            return res.status(404).json({ error: 'No se encontraron órdenes' });
        }

        let allOrders = callOrders.docs.map(doc => {
            const data = doc.data();
            return {
                ordenId: data.ordenId.slice(0, 8),
                nombreProducto: data.nombreProducto,
                precioPedido: data.precioPedido,
                cantidad: `${data.cantidad} ${data.unidad}`,
                fechaEntrega: data.fechaEntrega,
                estado: data.estado
            };
        });

        // Aplicar filtro por estado
        if (estado) {
            allOrders = allOrders.filter(order => order.estado.toLowerCase() === estado.toLowerCase());
        }

        // Ordenar por campo especificado
        allOrders.sort((a, b) => {
            if (sortField in a && sortField in b) {
                if (sortOrder === 'asc') return a[sortField] > b[sortField] ? 1 : -1;
                return a[sortField] < b[sortField] ? 1 : -1;
            }
            return 0;
        });

        const start = (parsedPage - 1) * parsedLimit;
        const end = start + parsedLimit;
        const paginatedOrders = allOrders.slice(start, end);

        res.status(200).json({
            total: allOrders.length,
            page: parsedPage,
            limit: parsedLimit,
            totalPages: Math.ceil(allOrders.length / parsedLimit),
            orders: paginatedOrders,
        });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener las órdenes', details: error.message });
    }
});

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

router.get('/ordenesall', async (req, res) => {
    try {
        // Obtener todas las órdenes sin filtros ni paginación
        const callOrders = await ordersCollection.get();
        if (callOrders.empty) {
            return res.status(404).json({ error: 'No se encontraron órdenes' })
        }

        let allOrders = callOrders.docs.map(doc => {
            const data = doc.data()
            return {
                ordenId: data.ordenId.slice(0, 8),
                nombreProducto: data.nombreProducto,
                precioPedido: data.precioPedido,
                cantidad: `${data.cantidad} ${data.unidad}`,
                fechaEntrega: data.fechaEntrega,
                estado: data.estado
            }
        })

        // Responder con la lista completa de órdenes
        res.status(200).json({
            total: allOrders.length,
            orders: allOrders,
        })
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener las órdenes', details: error.message })
    }
})

export default router;
