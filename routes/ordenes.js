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
        const ordenId = uuidv4()

        // Verificar que el producto existe
        const findProductSnapshot = await productCollection.where('nombre', '==', nombreProducto).get()
        if (findProductSnapshot.empty) {
            return res.status(400).json({ error: 'El producto no existe' })
        }

        // Obtener el producto
        const productDoc = findProductSnapshot.docs[0]
        const productData = productDoc.data()

        if (!dateRegex.test(fechaEntrega)) {
            return res.status(400).json({ error: 'La fecha debe tener el formato YYYY-MM-DD.' })
        }

        const fechaEntregaDate = new Date(fechaEntrega)
        const fechaActual = new Date()

        if (fechaEntregaDate <= fechaActual) {
            return res.status(400).json({ error: 'La fecha de entrega debe ser mayor a la fecha actual.' })
        }

        // Verificar la cantidad en inventario
        if (productData.cantidad < cantidad) {
            return res.status(400).json({ error: 'Cantidad insuficiente en inventario.' });
        }

        // Reducir la cantidad en inventario
        const nuevaCantidad = productData.cantidad - cantidad;

        // Actualizar el inventario
        await productCollection.doc(productDoc.id).update({
            cantidad: nuevaCantidad
        });

        let alerta = null;
        if (nuevaCantidad <= 0) {
            alerta = "Este producto está agotado, pide más al proveedor.";
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
        });

        const responseMessage = alerta 
            ? { message: 'Orden creada exitosamente', alerta } 
            : { message: 'Orden creada exitosamente' };

            res.status(201).json(responseMessage);

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

router.get('/categorias-vendidas', async (req, res) => {
    try {
      const currentDate = new Date();
      
      // Calcular el inicio y fin del mes actual
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  
      // Calcular el inicio y fin del mes anterior
      const startOfPreviousMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
      const endOfPreviousMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 0);
  
      // Convertir las fechas a cadenas con formato "YYYY-MM-DD"
      const startOfMonthStr = startOfMonth.toISOString().split('T')[0];  // "2024-11-01"
      const endOfMonthStr = endOfMonth.toISOString().split('T')[0];      // "2024-11-30"
  
      const startOfPreviousMonthStr = startOfPreviousMonth.toISOString().split('T')[0];  // "2024-10-01"
      const endOfPreviousMonthStr = endOfPreviousMonth.toISOString().split('T')[0];      // "2024-10-31"
  
      // Obtener las órdenes para el mes actual
      const callOrdersCurrentMonth = await ordersCollection
        .where('fechaEntrega', '>=', startOfMonthStr)
        .where('fechaEntrega', '<=', endOfMonthStr)
        .get();
  
      if (callOrdersCurrentMonth.empty) {
        return res.status(404).json({ error: 'No se encontraron órdenes para este mes' });
      }
  
      // Obtener las órdenes para el mes anterior
      const callOrdersPreviousMonth = await ordersCollection
        .where('fechaEntrega', '>=', startOfPreviousMonthStr)
        .where('fechaEntrega', '<=', endOfPreviousMonthStr)
        .get();
  
      // Obtener los productos
      const callProducts = await productCollection.get();
      const productos = callProducts.docs.map(doc => {
        const data = doc.data();
        return {
          nombre: data.nombre,
          categoria: data.categoria, // Suponiendo que cada producto tiene un campo 'categoria'
        };
      });
  
      // Función para calcular las ventas por categoría
      const calculateSalesByCategory = (orders) => {
        let salesByCategory = {};
        orders.forEach(doc => {
          const data = doc.data();
          const productName = data.nombreProducto;
          const price = data.precioPedido; // Usamos el precio del pedido en lugar de la cantidad
  
          // Encontrar la categoría del producto
          const product = productos.find(p => p.nombre === productName);
          if (product) {
            const categoria = product.categoria;
  
            if (!salesByCategory[categoria]) {
              salesByCategory[categoria] = 0;
            }
  
            salesByCategory[categoria] += price; // Sumar el precio del pedido
          }
        });
        return salesByCategory;
      };
  
      // Calcular las ventas por categoría para el mes actual y el mes anterior
      const salesCurrentMonth = calculateSalesByCategory(callOrdersCurrentMonth.docs);
      const salesPreviousMonth = calculateSalesByCategory(callOrdersPreviousMonth.docs);
  
      // Calcular el incremento comparado con el mes anterior
      let categoriesWithIncrement = [];
      for (let categoria in salesCurrentMonth) {
        let currentMonthSales = salesCurrentMonth[categoria];
        let previousMonthSales = salesPreviousMonth[categoria] || 0; // Si no hay ventas en el mes anterior, será 0
        let increment = 0;
  
        if (previousMonthSales > 0) {
          increment = ((currentMonthSales - previousMonthSales) / previousMonthSales) * 100;
        }
  
        categoriesWithIncrement.push({
          categoria: categoria,
          volumen: currentMonthSales,
          incremento: increment,
        });
      }
  
      // Ordenar las categorías por volumen de ventas (descendente)
      categoriesWithIncrement.sort((a, b) => b.volumen - a.volumen);
  
      // Devolver las dos categorías más vendidas
      res.status(200).json({
        categorias: categoriesWithIncrement.slice(0, 2),
      });
  
    } catch (error) {
      res.status(500).json({ error: 'Error al obtener las categorías más vendidas', details: error.message });
    }
});  

router.get('/categorias-vendidas-sinLim', async (req, res) => {
    try {
      const currentDate = new Date();
      
      // Calcular el inicio y fin del mes actual
      const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
  
      // Calcular el inicio y fin del mes anterior
      const startOfPreviousMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
      const endOfPreviousMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 0);
  
      // Convertir las fechas a cadenas con formato "YYYY-MM-DD"
      const startOfMonthStr = startOfMonth.toISOString().split('T')[0];  // "2024-11-01"
      const endOfMonthStr = endOfMonth.toISOString().split('T')[0];      // "2024-11-30"
  
      const startOfPreviousMonthStr = startOfPreviousMonth.toISOString().split('T')[0];  // "2024-10-01"
      const endOfPreviousMonthStr = endOfPreviousMonth.toISOString().split('T')[0];      // "2024-10-31"
  
      // Obtener las órdenes para el mes actual
      const callOrdersCurrentMonth = await ordersCollection
        .where('fechaEntrega', '>=', startOfMonthStr)
        .where('fechaEntrega', '<=', endOfMonthStr)
        .get();
  
      if (callOrdersCurrentMonth.empty) {
        return res.status(404).json({ error: 'No se encontraron órdenes para este mes' });
      }
  
      // Obtener las órdenes para el mes anterior
      const callOrdersPreviousMonth = await ordersCollection
        .where('fechaEntrega', '>=', startOfPreviousMonthStr)
        .where('fechaEntrega', '<=', endOfPreviousMonthStr)
        .get();
  
      // Obtener los productos
      const callProducts = await productCollection.get();
      const productos = callProducts.docs.map(doc => {
        const data = doc.data();
        return {
          nombre: data.nombre,
          categoria: data.categoria, // Suponiendo que cada producto tiene un campo 'categoria'
        };
      });
  
      // Función para calcular las ventas por categoría
      const calculateSalesByCategory = (orders) => {
        let salesByCategory = {};
        orders.forEach(doc => {
          const data = doc.data();
          const productName = data.nombreProducto;
          const price = data.precioPedido; // Usamos el precio del pedido en lugar de la cantidad
  
          // Encontrar la categoría del producto
          const product = productos.find(p => p.nombre === productName);
          if (product) {
            const categoria = product.categoria;
  
            if (!salesByCategory[categoria]) {
              salesByCategory[categoria] = 0;
            }
  
            salesByCategory[categoria] += price; // Sumar el precio del pedido
          }
        });
        return salesByCategory;
      };
  
      // Calcular las ventas por categoría para el mes actual y el mes anterior
      const salesCurrentMonth = calculateSalesByCategory(callOrdersCurrentMonth.docs);
      const salesPreviousMonth = calculateSalesByCategory(callOrdersPreviousMonth.docs);
  
      // Calcular el incremento comparado con el mes anterior
      let categoriesWithIncrement = [];
      for (let categoria in salesCurrentMonth) {
        let currentMonthSales = salesCurrentMonth[categoria];
        let previousMonthSales = salesPreviousMonth[categoria] || 0; // Si no hay ventas en el mes anterior, será 0
        let increment = 0;
  
        if (previousMonthSales > 0) {
          increment = ((currentMonthSales - previousMonthSales) / previousMonthSales) * 100;
        }
  
        categoriesWithIncrement.push({
          categoria: categoria,
          volumen: currentMonthSales,
          incremento: increment,
        });
      }
  
      // Ordenar las categorías por volumen de ventas (descendente)
      categoriesWithIncrement.sort((a, b) => b.volumen - a.volumen);
  
      // Devolver todas las categorías ordenadas por volumen de ventas
      res.status(200).json({
        categorias: categoriesWithIncrement,
      });
  
    } catch (error) {
      res.status(500).json({ error: 'Error al obtener las categorías más vendidas', details: error.message });
    }
});
  
router.get('/productos-vendidos', async (req, res) => {
  try {
    const currentDate = new Date();

    // Calcular el inicio y fin del mes actual
    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

    // Calcular el inicio y fin del mes anterior
    const startOfPreviousMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    const endOfPreviousMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 0);

    // Convertir las fechas a cadenas con formato "YYYY-MM-DD"
    const startOfMonthStr = startOfMonth.toISOString().split('T')[0];
    const endOfMonthStr = endOfMonth.toISOString().split('T')[0];
    const startOfPreviousMonthStr = startOfPreviousMonth.toISOString().split('T')[0];
    const endOfPreviousMonthStr = endOfPreviousMonth.toISOString().split('T')[0];

    // Obtener las órdenes para el mes actual
    const callOrdersCurrentMonth = await ordersCollection
      .where('fechaEntrega', '>=', startOfMonthStr)
      .where('fechaEntrega', '<=', endOfMonthStr)
      .get();

    if (callOrdersCurrentMonth.empty) {
      return res.status(404).json({ error: 'No se encontraron órdenes para este mes' });
    }

    // Obtener las órdenes para el mes anterior
    const callOrdersPreviousMonth = await ordersCollection
      .where('fechaEntrega', '>=', startOfPreviousMonthStr)
      .where('fechaEntrega', '<=', endOfPreviousMonthStr)
      .get();

    // Obtener los productos
    const callProducts = await productCollection.get();
    const productMap = {};
    callProducts.docs.forEach(doc => {
      const data = doc.data();
      productMap[data.productId] = {
        nombre: data.nombre,
        categoria: data.categoria,
        cantidad: data.cantidad,
      };
    });

    // Función para calcular las ventas por producto
    const calculateSalesByProduct = (orders) => {
      let salesByProduct = {};
      orders.forEach(doc => {
        const data = doc.data();
        const productId = data.productoId; // Asegúrate de usar productoId de la tabla órdenes

        if (!salesByProduct[productId]) {
          salesByProduct[productId] = { totalSales: 0, cantidad: 0 };
        }

        salesByProduct[productId].totalSales += data.precioPedido;
        salesByProduct[productId].cantidad += 1; // Puedes usar otro campo si representa la cantidad restante
      });
      return salesByProduct;
    };

    // Calcular las ventas por producto para el mes actual y el mes anterior
    const salesCurrentMonth = calculateSalesByProduct(callOrdersCurrentMonth.docs);
    const salesPreviousMonth = calculateSalesByProduct(callOrdersPreviousMonth.docs);

    // Calcular el incremento comparado con el mes anterior
    let productsWithIncrement = [];
    for (let productId in salesCurrentMonth) {
      const currentData = salesCurrentMonth[productId];
      const previousMonthSales = salesPreviousMonth[productId]?.totalSales || 0;
      const productData = productMap[productId];

      // Validar que productData exista en la tabla productos
      if (!productData) {
        console.warn(`Producto con ID ${productId} no encontrado en la colección de productos.`);
        continue;
      }

      let increment = 0;
      if (previousMonthSales > 0) {
        increment = ((currentData.totalSales - previousMonthSales) / previousMonthSales) * 100;
      }

      productsWithIncrement.push({
        nombreProducto: productData.nombre,
        idProducto: productId,
        categoria: productData.categoria,
        cantidadRestante: productData.cantidad,
        volumen: currentData.totalSales,
        incremento: increment,
      });
    }

    // Ordenar los productos por volumen de ventas (descendente)
    productsWithIncrement.sort((a, b) => b.volumen - a.volumen);

    // Devolver los dos productos más vendidos
    res.status(200).json({
      productos: productsWithIncrement.slice(0, 2),
    });

  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los productos más vendidos', details: error.message });
  }
});

router.get('/productos-vendidos-sinLim', async (req, res) => {
  try {
    const currentDate = new Date();

    // Calcular el inicio y fin del mes actual
    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

    // Calcular el inicio y fin del mes anterior
    const startOfPreviousMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    const endOfPreviousMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 0);

    // Convertir las fechas a cadenas con formato "YYYY-MM-DD"
    const startOfMonthStr = startOfMonth.toISOString().split('T')[0];
    const endOfMonthStr = endOfMonth.toISOString().split('T')[0];
    const startOfPreviousMonthStr = startOfPreviousMonth.toISOString().split('T')[0];
    const endOfPreviousMonthStr = endOfPreviousMonth.toISOString().split('T')[0];

    // Obtener las órdenes para el mes actual
    const callOrdersCurrentMonth = await ordersCollection
      .where('fechaEntrega', '>=', startOfMonthStr)
      .where('fechaEntrega', '<=', endOfMonthStr)
      .get();

    if (callOrdersCurrentMonth.empty) {
      return res.status(404).json({ error: 'No se encontraron órdenes para este mes' });
    }

    // Obtener las órdenes para el mes anterior
    const callOrdersPreviousMonth = await ordersCollection
      .where('fechaEntrega', '>=', startOfPreviousMonthStr)
      .where('fechaEntrega', '<=', endOfPreviousMonthStr)
      .get();

    // Obtener los productos
    const callProducts = await productCollection.get();
    const productMap = {};
    callProducts.docs.forEach(doc => {
      const data = doc.data();
      productMap[data.productId] = {
        nombre: data.nombre,
        categoria: data.categoria,
        cantidad: data.cantidad,
      };
    });

    // Función para calcular las ventas por producto
    const calculateSalesByProduct = (orders) => {
      let salesByProduct = {};
      orders.forEach(doc => {
        const data = doc.data();
        const productId = data.productoId; // Asegúrate de usar productoId de la tabla órdenes

        if (!salesByProduct[productId]) {
          salesByProduct[productId] = { totalSales: 0, cantidad: 0 };
        }

        salesByProduct[productId].totalSales += data.precioPedido;
        salesByProduct[productId].cantidad += 1; // Puedes usar otro campo si representa la cantidad restante
      });
      return salesByProduct;
    };

    // Calcular las ventas por producto para el mes actual y el mes anterior
    const salesCurrentMonth = calculateSalesByProduct(callOrdersCurrentMonth.docs);
    const salesPreviousMonth = calculateSalesByProduct(callOrdersPreviousMonth.docs);

    // Calcular el incremento comparado con el mes anterior
    let productsWithIncrement = [];
    for (let productId in salesCurrentMonth) {
      const currentData = salesCurrentMonth[productId];
      const previousMonthSales = salesPreviousMonth[productId]?.totalSales || 0;
      const productData = productMap[productId];

      // Validar que productData exista en la tabla productos
      if (!productData) {
        console.warn(`Producto con ID ${productId} no encontrado en la colección de productos.`);
        continue;
      }

      let increment = 0;
      if (previousMonthSales > 0) {
        increment = ((currentData.totalSales - previousMonthSales) / previousMonthSales) * 100;
      }

      productsWithIncrement.push({
        nombreProducto: productData.nombre,
        idProducto: productId,
        categoria: productData.categoria,
        cantidadRestante: productData.cantidad,
        volumen: currentData.totalSales,
        incremento: increment,
      });
    }

    // Ordenar los productos por volumen de ventas (descendente)
    productsWithIncrement.sort((a, b) => b.volumen - a.volumen);

    // Devolver los dos productos más vendidos
    res.status(200).json({
      productos: productsWithIncrement,
    });

  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los productos más vendidos', details: error.message });
  }
});

router.get('/productos-mas-vendidos', async (req, res) => { 
  try {
    const productSnapshot = await productCollection.get()
    const orderSnapshot = await ordersCollection.get()

    const productMap = {}
    const orderMap = {}

    // Obteniendo los productos con su precioCompra
    productSnapshot.forEach((doc) => {
      const data = doc.data();
      productMap[data.productId] = {
        nombre: data.nombre,
        cantidadRestante: data.cantidad,
        precio: data.precioCompra, // Usamos el precioCompra aquí
        cantidadVendida: 0,
      }
    })

    // Calculando las cantidades vendidas
    orderSnapshot.forEach((doc) => {
      const data = doc.data();
      const { productoId, cantidad } = data

      if (productMap[productoId]) {
        productMap[productoId].cantidadVendida += cantidad
      }
    })

    const filteredProducts = Object.values(productMap).filter(
      (product) => product.cantidadRestante > 0
    )

    const sortedProducts = filteredProducts.sort((a, b) => b.precio - a.precio)

    const topProducts = sortedProducts.slice(0, 3)

    while (topProducts.length < 3) {
      topProducts.push({
        nombre: '',
        cantidadVendida: '',
        cantidadRestante: '',
        precio: '',
      })
    }

    res.status(200).json({ topProducts })
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los productos más vendidos', details: error.message })
  }
})

router.get('/productos-mas-vendidos-sinLim', async (req, res) => { 
  try {
    const productSnapshot = await productCollection.get()
    const orderSnapshot = await ordersCollection.get()

    const productMap = {}
    const orderMap = {}

    // Obteniendo los productos con su precioCompra
    productSnapshot.forEach((doc) => {
      const data = doc.data();
      productMap[data.productId] = {
        nombre: data.nombre,
        cantidadRestante: data.cantidad,
        precio: data.precioCompra, // Usamos el precioCompra aquí
        cantidadVendida: 0,
      }
    })

    // Calculando las cantidades vendidas
    orderSnapshot.forEach((doc) => {
      const data = doc.data();
      const { productoId, cantidad } = data

      if (productMap[productoId]) {
        productMap[productoId].cantidadVendida += cantidad
      }
    })

    const filteredProducts = Object.values(productMap).filter(
      (product) => product.cantidadRestante > 0
    )

    const sortedProducts = filteredProducts.sort((a, b) => b.precio - a.precio)

    const topProducts = sortedProducts

    while (topProducts.length < 3) {
      topProducts.push({
        nombre: '',
        cantidadVendida: '',
        cantidadRestante: '',
        precio: '',
      })
    }

    res.status(200).json({ topProducts })
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los productos más vendidos', details: error.message })
  }
})

import moment from 'moment'

router.get('/ordenes/estadisticas', async (req, res) => {
    try {
        // Obtener la fecha actual y calcular los últimos 5 meses
        const now = moment()
        const months = [...Array(5)].map((_, i) => now.clone().subtract(i, 'months'))
        const labels = months.reverse().map((m) => m.format('MMMM YYYY'))

        // Inicializar los arrays para cada estado
        let enCamino = Array(5).fill(0)
        let confirmado = Array(5).fill(0)

        // Consultar las órdenes con estado "En camino" o "Confirmado"
        const snapshot = await ordersCollection
            .where('estado', 'in', ['En camino', 'Confirmado'])
            .get()

        if (snapshot.empty) {
            return res.status(200).json({
                labels,
                "En Camino": enCamino,
                "Confirmado": confirmado,
            })
        }

        // Procesar las órdenes
        snapshot.forEach((doc) => {
            const order = doc.data();
            const orderDate = moment(order.fechaEntrega, 'YYYY-MM-DD') // Formato de fecha

            // Encontrar el mes correspondiente
            const monthIndex = months.findIndex((m) =>
                orderDate.isSame(m, 'month')
            )

            if (monthIndex !== -1) {
                // Clasificar por estado y sumar los ingresos
                if (order.estado === 'En camino') {
                    enCamino[monthIndex] += order.precioPedido
                } else if (order.estado === 'Confirmado') {
                    confirmado[monthIndex] += order.precioPedido
                }
            }
        })

        // Responder con los datos procesados
        res.status(200).json({
            labels,
            "En Camino": enCamino,
            "Confirmado": confirmado,
        })

    } catch (error) {
        res.status(500).json({
            error: 'Error al obtener estadísticas de órdenes',
            details: error.message,
        })
    }
})

export { ordersCollection }
export default router;
