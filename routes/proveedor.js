import express from 'express'
import { db } from '../firebase.js'
import multer from 'multer'
import { ordersCollection } from './ordenes.js'

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
    const { 
        nombreProducto, 
        categoria, 
        precioPedido, 
        cantidad, 
        unidad, 
        nombreProveedor, 
        correoProveedor, 
        fechaEntrega, 
        estado 
    } = req.body

    // Validaciones
    if (!nombreProveedor) {
        return res.status(400).json({ error: 'El nombre del proveedor es obligatorio.' })
    }

    if (!correoProveedor) {
        return res.status(400).json({ error: 'El correo del proveedor es obligatorio.' })
    }

    if (!fechaEntrega || new Date(fechaEntrega) <= new Date()) {
        return res.status(400).json({ error: 'La fecha de entrega debe ser mayor a la fecha actual.' })
    }

    const estadosPermitidos = ['Cancelada', 'Regresada', 'Recibida', 'En espera']
    const estadoFinal = estado && estadosPermitidos.includes(estado) ? estado : 'En espera'

    try {
        const callProveedor = await supplierCollection
            .where('nombreProveedor', '==', nombreProveedor)
            .where('producto', '==', nombreProducto)
            .get()

        if (callProveedor.empty) {
            return res.status(404).json({ error: 'El proveedor no ofrece este producto.' })
        }

        await supplierOrderCollection.add({
            nombreProducto,
            categoria,
            precioPedido: parseFloat(precioPedido),
            cantidad: parseInt(cantidad),
            unidad,
            nombreProveedor,
            correoProveedor,
            fechaEntrega,
            estado: estadoFinal,
        })

        res.status(201).json({ message: 'Orden creada exitosamente', estado: estadoFinal })
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
                fechaEntrega: data.fechaEntrega,
            }
        })

        res.status(200).json(ordenProveedor)
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener las órdenes de proveedor', details: error.message })
    }
})

router.get('/totalProfit', async (req, res) => {
    try {
        // Obtener las órdenes con estado "entregado"
        const callOrders = await ordersCollection.where('estado', '==', 'Confirmado').get();
        
        if (callOrders.empty) {
            return res.status(404).json({ error: 'No se encontraron órdenes entregadas' });
        }

        // Sumar el precioPedido de las órdenes entregadas
        let totalOrdenesEntregadas = 0;
        callOrders.docs.forEach(doc => {
            const data = doc.data();
            totalOrdenesEntregadas += parseFloat(data.precioPedido);
        });

        // Obtener las órdenes a proveedores
        const callOrdersSupplier = await supplierOrderCollection.get();
        let totalOrdenesProveedor = 0;

        if (!callOrdersSupplier.empty) {
            for (const doc of callOrdersSupplier.docs) {
                const data = doc.data();
                // Buscar el precio de compra del proveedor
                const supplier = await supplierCollection
                    .where('nombreProveedor', '==', data.nombreProveedor)
                    .where('producto', '==', data.nombreProducto)
                    .get();

                if (!supplier.empty) {
                    const supplierData = supplier.docs[0].data();
                    const precioCompra = parseFloat(supplierData.precioCompra);  // Suponiendo que el campo es precioCompra
                    totalOrdenesProveedor += precioCompra * parseInt(data.cantidad);
                }
            }
        }

        // Calcular el profit
        const totalProfit = totalOrdenesEntregadas - totalOrdenesProveedor;

        res.status(200).json({ totalProfit });

    } catch (error) {
        res.status(500).json({ error: 'Error al obtener el total de ganancias', details: error.message });
    }
})

router.get('/totalProfitMonth', async (req, res) => {
    try {
        const currentDate = new Date();
        const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

        // Convertir las fechas a cadenas con formato "YYYY-MM-DD"
        const startOfMonthStr = startOfMonth.toISOString().split('T')[0];  // "2024-11-01"
        const endOfMonthStr = endOfMonth.toISOString().split('T')[0]; 

        console.log('Fecha inicio del mes:', startOfMonthStr);
        console.log('Fecha fin del mes:', endOfMonthStr);

        const callOrders = await ordersCollection
            .where('estado', '==', 'Confirmado')
            .where('fechaEntrega', '>=', startOfMonthStr)
            .where('fechaEntrega', '<=', endOfMonthStr)
            .get();
        
        if (callOrders.empty) {
            return res.status(404).json({ error: 'No se encontraron órdenes confirmadas en este mes' });
        }

        let totalOrdenesEntregadas = 0;
        callOrders.docs.forEach(doc => {
            const data = doc.data();
            totalOrdenesEntregadas += parseFloat(data.precioPedido);
        });

        const callOrdersSupplier = await supplierOrderCollection
            .where('fechaEntrega', '>=', startOfMonthStr)
            .where('fechaEntrega', '<=', endOfMonthStr)
            .get();

        let totalOrdenesProveedor = 0;
        if (!callOrdersSupplier.empty) {
            for (const doc of callOrdersSupplier.docs) {
                const data = doc.data();
                const supplier = await supplierCollection
                    .where('nombreProveedor', '==', data.nombreProveedor)
                    .where('producto', '==', data.nombreProducto)
                    .get();

                if (!supplier.empty) {
                    const supplierData = supplier.docs[0].data();
                    const precioCompra = parseFloat(supplierData.precioCompra);
                    totalOrdenesProveedor += precioCompra * parseInt(data.cantidad);
                }
            }
        }

        const totalProfit = totalOrdenesEntregadas - totalOrdenesProveedor;
        console.log('Total ganancias del mes:', totalProfit);

        res.status(200).json({ totalProfit });

    } catch (error) {
        console.error('Error en el servidor:', error);
        res.status(500).json({ error: 'Error al obtener el total de ganancias del mes', details: error.message });
    }
})

router.get('/totalProfitYear', async (req, res) => {
    try {
        const currentDate = new Date()
        const startOfYear = new Date(currentDate.getFullYear(), 0, 1)
        const endOfYear = new Date(currentDate.getFullYear(), 11, 31)

        const startOfYearStr = startOfYear.toISOString().split('T')[0];  // "2024-11-01"
        const endOfYearStr = endOfYear.toISOString().split('T')[0]; 

        console.log('Fecha inicio del año:', startOfYearStr);
        console.log('Fecha fin del año:', endOfYearStr);

        // Obtener las órdenes con estado "Confirmado" del año actual
        const callOrders = await ordersCollection
            .where('estado', '==', 'Confirmado')
            .where('fechaEntrega', '>=', startOfYearStr)
            .where('fechaEntrega', '<=', endOfYearStr)
            .get()
        
        if (callOrders.empty) {
            return res.status(404).json({ error: 'No se encontraron órdenes confirmadas en este año' });
        }

        // Sumar el precioPedido de las órdenes entregadas
        let totalOrdenesEntregadas = 0;
        callOrders.docs.forEach(doc => {
            const data = doc.data();
            totalOrdenesEntregadas += parseFloat(data.precioPedido);
        })

        // Obtener las órdenes a proveedores del año actual
        const callOrdersSupplier = await supplierOrderCollection
            .where('fechaEntrega', '>=', startOfYearStr)
            .where('fechaEntrega', '<=', endOfYearStr)
            .get()
        let totalOrdenesProveedor = 0

        if (!callOrdersSupplier.empty) {
            for (const doc of callOrdersSupplier.docs) {
                const data = doc.data()
                // Buscar el precio de compra del proveedor
                const supplier = await supplierCollection
                    .where('nombreProveedor', '==', data.nombreProveedor)
                    .where('producto', '==', data.nombreProducto)
                    .get()

                if (!supplier.empty) {
                    const supplierData = supplier.docs[0].data()
                    const precioCompra = parseFloat(supplierData.precioCompra)  // Suponiendo que el campo es precioCompra
                    totalOrdenesProveedor += precioCompra * parseInt(data.cantidad)
                }
            }
        }

        // Calcular el profit
        const totalProfit = totalOrdenesEntregadas - totalOrdenesProveedor

        res.status(200).json({ totalProfit })

    } catch (error) {
        res.status(500).json({ error: 'Error al obtener el total de ganancias del año', details: error.message })
    }
})

router.get('/totalProfitDay', async (req, res) => {
    try {
        const currentDate = new Date();
        const currentDateStr = currentDate.toISOString().split('T')[0]; // "YYYY-MM-DD"

        // Órdenes confirmadas del día actual
        const callOrders = await ordersCollection
            .where('estado', '==', 'Confirmado')
            .where('fechaEntrega', '==', currentDateStr)
            .get();

        let totalOrdenesEntregadas = 0;
        callOrders.docs.forEach(doc => {
            const data = doc.data();
            totalOrdenesEntregadas += parseFloat(data.precioPedido);
        });

        // Órdenes a proveedores del día actual
        const callOrdersSupplier = await supplierOrderCollection
            .where('fechaEntrega', '==', currentDateStr)
            .get();

        let totalOrdenesProveedor = 0;
        if (!callOrdersSupplier.empty) {
            for (const doc of callOrdersSupplier.docs) {
                const data = doc.data();
                const supplier = await supplierCollection
                    .where('nombreProveedor', '==', data.nombreProveedor)
                    .where('producto', '==', data.nombreProducto)
                    .get();

                if (!supplier.empty) {
                    const supplierData = supplier.docs[0].data();
                    const precioCompra = parseFloat(supplierData.precioCompra);
                    totalOrdenesProveedor += precioCompra * parseInt(data.cantidad);
                }
            }
        }

        const totalProfit = totalOrdenesEntregadas - totalOrdenesProveedor;
        res.status(200).json({ totalProfit });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener el total de ganancias diarias', details: error.message });
    }
})

router.get('/totalProfitWeek', async (req, res) => {
    try {
        const currentDate = new Date();
        const dayOfWeek = currentDate.getDay(); // 0 (domingo) a 6 (sábado)
        const startOfWeek = new Date(currentDate);
        startOfWeek.setDate(currentDate.getDate() - dayOfWeek + 1); // Lunes de la semana actual
        const endOfWeek = new Date(currentDate);
        endOfWeek.setDate(currentDate.getDate() + (7 - dayOfWeek)); // Domingo de la semana actual

        const startOfWeekStr = startOfWeek.toISOString().split('T')[0];
        const endOfWeekStr = endOfWeek.toISOString().split('T')[0];

        // Órdenes confirmadas de la semana
        const callOrders = await ordersCollection
            .where('estado', '==', 'Confirmado')
            .where('fechaEntrega', '>=', startOfWeekStr)
            .where('fechaEntrega', '<=', endOfWeekStr)
            .get();

        let totalOrdenesEntregadas = 0;
        callOrders.docs.forEach(doc => {
            const data = doc.data();
            totalOrdenesEntregadas += parseFloat(data.precioPedido);
        });

        // Órdenes a proveedores de la semana
        const callOrdersSupplier = await supplierOrderCollection
            .where('fechaEntrega', '>=', startOfWeekStr)
            .where('fechaEntrega', '<=', endOfWeekStr)
            .get();

        let totalOrdenesProveedor = 0;
        if (!callOrdersSupplier.empty) {
            for (const doc of callOrdersSupplier.docs) {
                const data = doc.data();
                const supplier = await supplierCollection
                    .where('nombreProveedor', '==', data.nombreProveedor)
                    .where('producto', '==', data.nombreProducto)
                    .get();

                if (!supplier.empty) {
                    const supplierData = supplier.docs[0].data();
                    const precioCompra = parseFloat(supplierData.precioCompra);
                    totalOrdenesProveedor += precioCompra * parseInt(data.cantidad);
                }
            }
        }

        const totalProfit = totalOrdenesEntregadas - totalOrdenesProveedor;
        res.status(200).json({ totalProfit });
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener el total de ganancias semanales', details: error.message });
    }
})

router.get('/totalOrdenesProveedor', async (req, res) => {
    try {
        // Obtener todas las órdenes a proveedores
        const callOrdersSupplier = await supplierOrderCollection.get()

        if (callOrdersSupplier.empty) {
            return res.status(404).json({ error: 'No se encontraron órdenes a proveedores' })
        }

        let totalOrdenesProveedor = 0

        // Para cada orden a proveedor, obtenemos el precio de compra del proveedor y calculamos el total
        for (const doc of callOrdersSupplier.docs) {
            const data = doc.data()
            const cantidad = parseInt(data.cantidad)

            // Buscar el precio de compra del proveedor
            const supplier = await supplierCollection
                .where('nombreProveedor', '==', data.nombreProveedor)
                .where('producto', '==', data.nombreProducto)
                .get()

            if (!supplier.empty) {
                const supplierData = supplier.docs[0].data()
                const precioCompra = parseFloat(supplierData.precioCompra)  // Precio de compra de la pieza
                totalOrdenesProveedor += precioCompra * cantidad // Total por producto
            }
        }

        res.status(200).json({ totalOrdenesProveedor })
    } catch (error) {
        res.status(500).json({ error: 'Error al calcular el total de las órdenes a proveedores', details: error.message })
    }
})

router.get('/totalProfitMonthPuntos', async (req, res) => {
    try {
        const currentDate = new Date();
        const startOfYear = new Date(currentDate.getFullYear(), 0, 1); // Inicio del año actual
        const endOfYear = new Date(currentDate.getFullYear(), 11, 31); // Fin del año actual

        // Convertir las fechas a cadenas con formato "YYYY-MM-DD"
        const startOfYearStr = startOfYear.toISOString().split('T')[0];
        const endOfYearStr = endOfYear.toISOString().split('T')[0];

        console.log('Fecha inicio del año:', startOfYearStr);
        console.log('Fecha fin del año:', endOfYearStr);

        // Obtener todas las órdenes confirmadas del año actual
        const callOrders = await ordersCollection
            .where('estado', '==', 'Confirmado')
            .where('fechaEntrega', '>=', startOfYearStr)
            .where('fechaEntrega', '<=', endOfYearStr)
            .get();

        if (callOrders.empty) {
            return res.status(404).json({ error: 'No se encontraron órdenes confirmadas en este año' });
        }

        // Crear un objeto para acumular los ingresos por mes
        const monthlyData = {};
        for (let i = 0; i < 12; i++) {
            monthlyData[i + 1] = { revenue: 0, profit: 0, purchases: 0 }; // Inicializar con 0
        }

        // Sumar ingresos mensuales
        callOrders.docs.forEach(doc => {
            const data = doc.data();
            const month = new Date(data.fechaEntrega).getMonth() + 1; // Obtener el mes (1-12)
            monthlyData[month].revenue += parseFloat(data.precioPedido);
        });

        // Obtener órdenes de proveedores del año actual
        const callOrdersSupplier = await supplierOrderCollection
            .where('fechaEntrega', '>=', startOfYearStr)
            .where('fechaEntrega', '<=', endOfYearStr)
            .get();

        // Sumar costos de compras mensuales
        if (!callOrdersSupplier.empty) {
            for (const doc of callOrdersSupplier.docs) {
                const data = doc.data();
                const month = new Date(data.fechaEntrega).getMonth() + 1;

                const supplier = await supplierCollection
                    .where('nombreProveedor', '==', data.nombreProveedor)
                    .where('producto', '==', data.nombreProducto)
                    .get();

                if (!supplier.empty) {
                    const supplierData = supplier.docs[0].data();
                    const precioCompra = parseFloat(supplierData.precioCompra);
                    monthlyData[month].purchases += precioCompra * parseInt(data.cantidad);
                }
            }
        }

        // Calcular ganancias por mes
        for (const month in monthlyData) {
            monthlyData[month].profit = monthlyData[month].revenue - monthlyData[month].purchases;
        }

        // Formatear datos para la gráfica
        const labels = Object.keys(monthlyData).map(month => `Mes ${month}`);
        const revenueData = Object.values(monthlyData).map(data => data.revenue);
        const profitData = Object.values(monthlyData).map(data => data.profit);

        console.log('Datos mensuales:', monthlyData);

        res.status(200).json({ labels, revenue: revenueData, profit: profitData });
    } catch (error) {
        console.error('Error en el servidor:', error);
        res.status(500).json({ error: 'Error al obtener las ganancias mensuales', details: error.message });
    }
})

router.get('/totalProfitYearPuntos', async (req, res) => {
    try {
        const currentYear = new Date().getFullYear();
        const startYear = currentYear - 19; // El primer año en los últimos 20 años

        // Arrays para los resultados
        const labels = [];
        const revenue = [];
        const profit = [];

        for (let year = startYear; year <= currentYear; year++) {
            // Calcular el rango de fechas para el año actual
            const startOfYear = new Date(year, 0, 1);
            const endOfYear = new Date(year, 11, 31);

            const startOfYearStr = startOfYear.toISOString().split('T')[0];
            const endOfYearStr = endOfYear.toISOString().split('T')[0];

            console.log(`Procesando datos del año ${year}: ${startOfYearStr} - ${endOfYearStr}`);

            // Variables para acumuladores anuales
            let totalRevenue = 0;
            let totalPurchases = 0;

            // Obtener las órdenes confirmadas del año actual
            const callOrders = await ordersCollection
                .where('estado', '==', 'Confirmado')
                .where('fechaEntrega', '>=', startOfYearStr)
                .where('fechaEntrega', '<=', endOfYearStr)
                .get();

            if (!callOrders.empty) {
                callOrders.docs.forEach(doc => {
                    const data = doc.data();
                    totalRevenue += parseFloat(data.precioPedido);
                });
            }

            // Obtener las órdenes a proveedores del año actual
            const callOrdersSupplier = await supplierOrderCollection
                .where('fechaEntrega', '>=', startOfYearStr)
                .where('fechaEntrega', '<=', endOfYearStr)
                .get();

            if (!callOrdersSupplier.empty) {
                for (const doc of callOrdersSupplier.docs) {
                    const data = doc.data();
                    const supplier = await supplierCollection
                        .where('nombreProveedor', '==', data.nombreProveedor)
                        .where('producto', '==', data.nombreProducto)
                        .get();

                    if (!supplier.empty) {
                        const supplierData = supplier.docs[0].data();
                        const precioCompra = parseFloat(supplierData.precioCompra);
                        totalPurchases += precioCompra * parseInt(data.cantidad);
                    }
                }
            }

            // Calcular las ganancias (profit) del año
            const totalProfit = totalRevenue - totalPurchases;

            // Agregar resultados a los arrays
            labels.push(`Año ${year}`);
            revenue.push(totalRevenue);
            profit.push(totalProfit);
        }

        // Responder con los datos en el formato solicitado
        res.status(200).json({
            labels,
            revenue,
            profit
        });
    } catch (error) {
        console.error('Error en el servidor:', error);
        res.status(500).json({ error: 'Error al obtener los datos de los últimos 20 años', details: error.message });
    }
})

router.get('/totalProfitDayPuntos', async (req, res) => {
    try {
        const currentDate = new Date();
        const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

        const startOfMonthStr = startOfMonth.toISOString().split('T')[0];
        const endOfMonthStr = endOfMonth.toISOString().split('T')[0];

        console.log(`Procesando puntos por día del mes actual: ${startOfMonthStr} - ${endOfMonthStr}`);

        // Inicializar estructura de datos por día
        const daysInMonth = endOfMonth.getDate();
        const dailyData = Array.from({ length: daysInMonth }, () => ({ revenue: 0, profit: 0 }));

        // Obtener órdenes confirmadas del mes actual
        const callOrders = await ordersCollection
            .where('estado', '==', 'Confirmado')
            .where('fechaEntrega', '>=', startOfMonthStr)
            .where('fechaEntrega', '<=', endOfMonthStr)
            .get();

        if (!callOrders.empty) {
            callOrders.docs.forEach(doc => {
                const data = doc.data();
                // Interpretar la fecha como local para evitar desfases
                const fechaEntrega = new Date(data.fechaEntrega + "T00:00:00"); 
                const day = fechaEntrega.getDate(); // Día correcto en zona local
                dailyData[day - 1].revenue += parseFloat(data.precioPedido);
            });
        }

        // Obtener órdenes a proveedores del mes actual
        const callOrdersSupplier = await supplierOrderCollection
            .where('fechaEntrega', '>=', startOfMonthStr)
            .where('fechaEntrega', '<=', endOfMonthStr)
            .get();

        if (!callOrdersSupplier.empty) {
            for (const doc of callOrdersSupplier.docs) {
                const data = doc.data();
                // Interpretar la fecha como local para evitar desfases
                const fechaEntrega = new Date(data.fechaEntrega + "T00:00:00");
                const day = fechaEntrega.getDate();

                const supplier = await supplierCollection
                    .where('nombreProveedor', '==', data.nombreProveedor)
                    .where('producto', '==', data.nombreProducto)
                    .get();

                if (!supplier.empty) {
                    const supplierData = supplier.docs[0].data();
                    const precioCompra = parseFloat(supplierData.precioCompra);
                    dailyData[day - 1].profit -= precioCompra * parseInt(data.cantidad);
                }
            }
        }

        // Calcular las ganancias finales por día
        dailyData.forEach(day => {
            day.profit += day.revenue;
        });

        // Formatear los datos para la respuesta
        const labels = Array.from({ length: daysInMonth }, (_, i) => `Día ${i + 1}`);
        const revenue = dailyData.map(day => day.revenue);
        const profit = dailyData.map(day => day.profit);

        res.status(200).json({ labels, revenue, profit });
    } catch (error) {
        console.error('Error al calcular los puntos por día:', error);
        res.status(500).json({ error: 'Error al calcular los puntos por día del mes actual', details: error.message });
    }
})

router.get('/totalProfitWeekPuntos', async (req, res) => {
    try {
        const currentDate = new Date();
        const startOfPeriod = new Date(currentDate.getFullYear(), currentDate.getMonth() - 2, 1); // Inicio de hace 3 meses
        const endOfPeriod = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0); // Fin del mes actual

        const startOfPeriodStr = startOfPeriod.toISOString().split('T')[0];
        const endOfPeriodStr = endOfPeriod.toISOString().split('T')[0];

        console.log(`Procesando puntos por semana de los últimos 3 meses: ${startOfPeriodStr} - ${endOfPeriodStr}`);

        // Inicializar estructura de datos por semana
        const weeklyData = {};
        for (let i = 0; i < 13; i++) {
            weeklyData[i + 1] = { revenue: 0, profit: 0 }; // 13 semanas en 3 meses aprox.
        }

        // Obtener órdenes confirmadas del período
        const callOrders = await ordersCollection
            .where('estado', '==', 'Confirmado')
            .where('fechaEntrega', '>=', startOfPeriodStr)
            .where('fechaEntrega', '<=', endOfPeriodStr)
            .get();

        if (!callOrders.empty) {
            callOrders.docs.forEach(doc => {
                const data = doc.data();
                const week = Math.ceil(new Date(data.fechaEntrega).getDate() / 7); // Obtener la semana
                weeklyData[week].revenue += parseFloat(data.precioPedido);
            });
        }

        // Obtener órdenes a proveedores del período
        const callOrdersSupplier = await supplierOrderCollection
            .where('fechaEntrega', '>=', startOfPeriodStr)
            .where('fechaEntrega', '<=', endOfPeriodStr)
            .get();

        if (!callOrdersSupplier.empty) {
            for (const doc of callOrdersSupplier.docs) {
                const data = doc.data();
                const week = Math.ceil(new Date(data.fechaEntrega).getDate() / 7);

                const supplier = await supplierCollection
                    .where('nombreProveedor', '==', data.nombreProveedor)
                    .where('producto', '==', data.nombreProducto)
                    .get();

                if (!supplier.empty) {
                    const supplierData = supplier.docs[0].data();
                    const precioCompra = parseFloat(supplierData.precioCompra);
                    weeklyData[week].profit -= precioCompra * parseInt(data.cantidad);
                }
            }
        }

        // Calcular las ganancias finales por semana
        for (const week in weeklyData) {
            weeklyData[week].profit += weeklyData[week].revenue;
        }

        // Formatear los datos para la respuesta
        const labels = Object.keys(weeklyData).map(week => `Semana ${week}`);
        const revenue = Object.values(weeklyData).map(data => data.revenue);
        const profit = Object.values(weeklyData).map(data => data.profit);

        res.status(200).json({ labels, revenue, profit });
    } catch (error) {
        console.error('Error al calcular los puntos por semana:', error);
        res.status(500).json({ error: 'Error al calcular los puntos por semana de los últimos 3 meses', details: error.message });
    }
})

router.get('/totalProfitToday', async (req, res) => {
    try {
        const currentDate = new Date();
        const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

        // Convertir las fechas a cadenas con formato "YYYY-MM-DD"
        const startOfMonthStr = startOfMonth.toISOString().split('T')[0]; // "2024-11-01"
        const endOfMonthStr = endOfMonth.toISOString().split('T')[0]; // "2024-11-30"

        // Obtener las órdenes entregadas del mes actual
        const callOrders = await ordersCollection
            .where('estado', '==', 'Confirmado')
            .where('fechaEntrega', '>=', startOfMonthStr)
            .where('fechaEntrega', '<=', endOfMonthStr)
            .get();

        if (callOrders.empty) {
            return res.status(200).json({ totalProfit: 0 }) 
        }

        let totalOrdenesEntregadas = 0
        callOrders.docs.forEach(doc => {
            const data = doc.data()
            totalOrdenesEntregadas += parseFloat(data.precioPedido)
        })

        // Obtener las órdenes a proveedores del mes actual
        const callOrdersSupplier = await supplierOrderCollection
            .where('fechaEntrega', '>=', startOfMonthStr)
            .where('fechaEntrega', '<=', endOfMonthStr)
            .get()

        let totalOrdenesProveedor = 0

        if (!callOrdersSupplier.empty) {
            for (const doc of callOrdersSupplier.docs) {
                const data = doc.data();
                const supplier = await supplierCollection
                    .where('nombreProveedor', '==', data.nombreProveedor)
                    .where('producto', '==', data.nombreProducto)
                    .get()

                if (!supplier.empty) {
                    const supplierData = supplier.docs[0].data()
                    const precioCompra = parseFloat(supplierData.precioCompra)
                    totalOrdenesProveedor += precioCompra * parseInt(data.cantidad)
                }
            }
        }

        // Calcular la ganancia total del mes
        const totalProfit = totalOrdenesEntregadas - totalOrdenesProveedor

        res.status(200).json({ totalProfit })
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener el total de ganancias del mes', details: error.message })
    }
})

router.get('/sumarCantidadEnEspera', async (req, res) => {
    try {
        const querySnapshot = await supplierOrderCollection
            .where('estado', '==', 'En espera')
            .get()

        if (querySnapshot.empty) {
            return res.status(404).json({ error: 'No hay órdenes en espera.' })
        }

        let totalCantidad = 0
        querySnapshot.forEach(doc => {
            const data = doc.data()
            totalCantidad += data.cantidad || 0
        })

        res.status(200).json({ totalCantidad })
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener las órdenes', details: error.message })
    }
})

router.get('/totalproveedores', async (req, res) => {
    try {
        const snapshot = await supplierCollection.get()
        const totalProveedores = snapshot.size
        res.status(200).json({ totalProveedores })
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener la cantidad total de proveedores', details: error.message })
    }
})

router.get('/totalordenescompradas', async (req, res) => {
    try {
        const snapshot = await supplierOrderCollection.get()
        const totalOrdenesCompra = snapshot.size
        res.status(200).json({ totalOrdenesCompra })
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener la cantidad total de ordenes', details: error.message })
    }
})

router.get('/sumarprecioordenes', async (req, res) => {
    try {
        const estadosValidos = ['Recibida', 'En espera'];
        const ordenesSnapshot = await supplierOrderCollection
            .where('estado', 'in', estadosValidos)
            .get()

        if (ordenesSnapshot.empty) {
            return res.status(404).json({ error: 'No se encontraron órdenes con estado "Recibida" o "En espera".' })
        }

        let totalPrecioPedido = 0

        for (const ordenDoc of ordenesSnapshot.docs) {
            const ordenData = ordenDoc.data();
            const { nombreProveedor, nombreProducto, cantidad } = ordenData

            const proveedorSnapshot = await supplierCollection
                .where('nombreProveedor', '==', nombreProveedor)
                .where('producto', '==', nombreProducto)
                .get()

            if (!proveedorSnapshot.empty) {
                const proveedorData = proveedorSnapshot.docs[0].data()
                const precioCompra = proveedorData.precioCompra

                const precioPedido = cantidad * precioCompra
                totalPrecioPedido += precioPedido
            }
        }

        res.status(200).json({ totalPrecioPedido })
    } catch (error) {
        res.status(500).json({ error: 'Error al calcular el total de las órdenes', details: error.message })
    }
})

router.get('/contarordenescanceladas', async (req, res) => {
    try {
        const ordenesSnapshot = await supplierOrderCollection
            .where('estado', '==', 'Cancelada')
            .get();

        if (ordenesSnapshot.empty) {
            return res.status(200).json({ totalCanceladas: 0 });
        }

        const totalCanceladas = ordenesSnapshot.size

        res.status(200).json({ totalCanceladas })
    } catch (error) {
        res.status(500).json({ error: 'Error al contar las órdenes canceladas', details: error.message })
    }
})

router.get('/sumarprecioordenesdevueltas', async (req, res) => {
    try {
        const estadosValidos = ['Regresada'];
        const ordenesSnapshot = await supplierOrderCollection
            .where('estado', 'in', estadosValidos)
            .get();

        let totalPrecioPedidoRegresadas = 0;

        if (!ordenesSnapshot.empty) {
            for (const ordenDoc of ordenesSnapshot.docs) {
                const ordenData = ordenDoc.data();
                const { nombreProveedor, nombreProducto, cantidad } = ordenData;

                const proveedorSnapshot = await supplierCollection
                    .where('nombreProveedor', '==', nombreProveedor)
                    .where('producto', '==', nombreProducto)
                    .get();

                if (!proveedorSnapshot.empty) {
                    const proveedorData = proveedorSnapshot.docs[0].data();
                    const precioCompra = proveedorData.precioCompra;

                    const precioPedido = cantidad * precioCompra;
                    totalPrecioPedidoRegresadas += precioPedido;
                }
            }
        }

        // Devuelve el total, que será 0 si no se encontraron órdenes
        res.status(200).json({ totalPrecioPedidoRegresadas });
    } catch (error) {
        res.status(500).json({ error: 'Error al calcular el total de las órdenes', details: error.message });
    }
});

import { startOfMonth, endOfMonth, eachMonthOfInterval, format } from 'date-fns';

router.get('/puntos', async (req, res) => {
    try {
        const currentYear = new Date().getFullYear();

        // Crear el rango de meses para el año actual
        const meses = eachMonthOfInterval({
            start: new Date(currentYear, 0, 1),
            end: new Date(currentYear, 11, 31),
        });

        // Inicializar arreglos de datos
        const comprasPorMes = Array(12).fill(0);
        const ventasPorMes = Array(12).fill(0);

        // Procesar órdenes de compras (crearordenproveedor)
        const ordenesProveedorSnapshot = await supplierOrderCollection.get();
        for (const doc of ordenesProveedorSnapshot.docs) {
            const orden = doc.data();
            const fecha = new Date(orden.fechaEntrega);
            if (fecha.getFullYear() === currentYear) {
                const mesIndex = fecha.getMonth();
                const proveedorSnapshot = await supplierCollection
                    .where('nombreProveedor', '==', orden.nombreProveedor)
                    .where('producto', '==', orden.nombreProducto)
                    .get();

                if (!proveedorSnapshot.empty) {
                    const proveedor = proveedorSnapshot.docs[0].data();
                    const precioCompra = parseFloat(proveedor.precioCompra) || 0;
                    const cantidad = parseInt(orden.cantidad) || 0;
                    comprasPorMes[mesIndex] += precioCompra * cantidad;
                }
            }
        }

        // Procesar órdenes de ventas (crearorden)
        const ordenesVentasSnapshot = await ordersCollection.get();
        for (const doc of ordenesVentasSnapshot.docs) {
            const orden = doc.data();
            const fecha = new Date(orden.fechaEntrega);
            if (fecha.getFullYear() === currentYear) {
                const mesIndex = fecha.getMonth();
                const precioPedido = parseFloat(orden.precioPedido) || 0;
                ventasPorMes[mesIndex] += precioPedido;
            }
        }

        // Formatear respuesta
        const resultado = {
            labels: meses.map((mes) => `Mes ${mes.getMonth() + 1}`),
            compra: comprasPorMes,
            venta: ventasPorMes,
        };

        res.status(200).json(resultado);
    } catch (error) {
        res.status(500).json({ error: 'Error al calcular los puntos', details: error.message });
    }
});

export default router
