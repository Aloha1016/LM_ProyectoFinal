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

        const findCorreo = await supplierCollection.where('correo', '==', correo).get()
        if (!findCorreo.empty) {
            return res.status(400).json({ error: 'El correo ya existe' })
        }

        const findnumero = await supplierCollection.where('numeroContacto', '==', numeroContacto).get()
        if (!findnumero.empty) {
            return res.status(400).json({ error: 'El numero ya existe' })
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
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 9;
        const startAfter = req.query.startAfter ? req.query.startAfter : null; // Usar null si no se pasa startAfter
        const sortField = req.query.sortField || 'nombreProveedor';
        const sortOrder = req.query.sortOrder === 'desc' ? 'desc' : 'asc';
        const filterType = req.query.filterType || null;

        let query = supplierCollection;

        // Filtro opcional
        if (filterType) {
            if (filterType === "taking-return") {
                query = query.where("Tipo", "==", "Acepta devolucion");
            } else if (filterType === "not-taking-return") {
                query = query.where("Tipo", "==", "No acepta devolucion");
            }
        }

        query = query.orderBy(sortField, sortOrder);

        if (startAfter) {
            const lastDocSnapshot = await supplierCollection.doc(startAfter).get();
            if (lastDocSnapshot.exists) {
                query = query.startAfter(lastDocSnapshot);
            }
        }        
        query = query.limit(limit);

        const callSupplier = await query.get();
        const lastDocId = callSupplier.docs.length ? callSupplier.docs[callSupplier.docs.length - 1].id : null;

        if (callSupplier.empty) {
            return res.status(200).json({
                proveedores: [],
                page,
                totalPages: 0,
                noMorePages: true,
            });
        }

        const proveedores = [];
        for (const doc of callSupplier.docs) {
            const data = doc.data();
            const callOrders = await supplierOrderCollection
                .where('nombreProducto', '==', data.producto)
                .where('nombreProveedor', '==', data.nombreProveedor)
                .get();

            let cantidadEnCamino = 0;
            if (!callOrders.empty) {
                cantidadEnCamino = callOrders.docs.reduce((acc, orderDoc) => {
                    const orderData = orderDoc.data();
                    return acc + (parseInt(orderData.cantidad) || 0);
                }, 0);
            }

            proveedores.push({
                id: doc.id,
                nombreProveedor: data.nombreProveedor,
                producto: data.producto,
                numeroContacto: data.numeroContacto,
                correo: data.correo,
                Tipo: data.Tipo,
                enCamino: cantidadEnCamino,
            });
        }

        let filteredTotal = supplierCollection;

            // Aplica los mismos filtros de la consulta principal
            if (filterType) {
                if (filterType === "taking-return") {
                    filteredTotal = filteredTotal.where("Tipo", "==", "Acepta devolucion");
                } else if (filterType === "not-taking-return") {
                    filteredTotal = filteredTotal.where("Tipo", "==", "No acepta devolucion");
                }
            }

            const totalProveedores = await filteredTotal.get();
            const totalPages = Math.ceil(totalProveedores.size / limit);

        res.status(200).json({
            proveedores,
            page,
            totalPages,
            noMorePages: page >= totalPages,
            startAfter: callSupplier.docs[callSupplier.docs.length - 1]?.id || null, // Enviar el id del último documento
            startAfter: lastDocId,
        });        
    } catch (error) {
        console.error('Error al obtener los proveedores:', error);
        res.status(500).json({ error: 'Error al obtener los proveedores', details: error.message });
    }
});

router.put('/marcarentregado/:orderId', async (req, res) => {
    const { orderId } = req.params

    try {
        const orderDoc = await supplierOrderCollection.doc(orderId).get()

        if (!orderDoc.exists) {
            return res.status(404).json({ error: 'El pedido no existe.' })
        }

        const orderData = orderDoc.data()

        const productQuery = await db.collection('productos').where('nombre', '==', orderData.nombreProducto).get()

        if (productQuery.empty) {
            return res.status(404).json({ error: 'Producto no encontrado.' })
        }

        const productDoc = productQuery.docs[0]
        const productData = productDoc.data()

        const nuevaCantidad = (productData.cantidad || 0) + orderData.cantidad
        await db.collection('productos').doc(productDoc.id).update({ cantidad: nuevaCantidad })

        await supplierOrderCollection.doc(orderId).delete()

        res.status(200).json({ message: 'Pedido marcado como entregado y producto actualizado.' })
    } catch (error) {
        res.status(500).json({ error: 'Error al procesar el pedido', details: error.message })
    }
})

router.get('/ordenesProveedor', async (req, res) => {
    try {
        const callOrdersSupplier = await supplierOrderCollection.get()

        if (callOrdersSupplier.empty) {
            return res.status(404).json({ error: 'No se encontraron órdenes a proveedores' })
        }

        const ordenProveedor = callOrdersSupplier.docs.map(doc => {
            const data = doc.data()

            return {
                id: doc.id,
                nombreProveedor: data.nombreProveedor,
                nombreProducto: data.nombreProducto,
                categoria: data.categoria,
                cantidad: `${data.cantidad} ${data.unidad}`,
            }
        })

        res.status(200).json(ordenProveedor)
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener las órdenes de proveedor', details: error.message })
    }
})

export default router
