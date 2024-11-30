import express from 'express'
import { db } from '../firebase.js'
import { supplierCollection } from './proveedor.js'
import { supplierOrderCollection } from './proveedor.js'
import { storeCollection } from './tiendas.js'
import { ordersCollection } from './ordenes.js'
import multer from 'multer'

const router = express.Router()
const productCollection = db.collection('productos')

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/productos/')
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${file.originalname}`
    cb(null, uniqueSuffix)
  },
})

const upload = multer({ storage })

router.post('/crearproducto', upload.single('imagen'), async (req, res) => {
  const { nombre, productId, categoria, precioCompra, cantidad, unidad, fechaCaducidad, valorUmbral } = req.body;

  try {
    const findProduct = await productCollection.where('productId', '==', productId).get();

    if (!findProduct.empty) {
      return res.status(400).json({ error: 'El ID del producto ya existe' });
    }

    let imagenUrl = null;

    if (req.file) {
      imagenUrl = `${req.protocol}://${req.get('host')}/uploads/productos/${req.file.filename}`;
    }

    // Determinar el estado del producto basado en la lógica
    let estado;
    if (cantidad == 0) {
      estado = 'Agotado';
    } else if (cantidad <= valorUmbral) {
      estado = 'Poca disponibilidad';
    } else {
      estado = 'Disponible';
    }

    // Guardar el producto en Firestore
    await productCollection.add({
      nombre,
      productId,
      categoria,
      precioCompra: parseFloat(precioCompra),
      cantidad: parseInt(cantidad),
      unidad,
      fechaCaducidad,
      valorUmbral: parseInt(valorUmbral),
      imagenUrl,
      estado, // Guardar el estado calculado
    });

    res.status(201).json({ message: 'Producto creado exitosamente', imagenUrl });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear el producto', details: error.message });
  }
});

router.get('/productos', async (req, res) => {
  try {
    const { estado, sortBy = 'nombre', sortOrder = 'asc', page = 1, limit = 5 } = req.query;

    const querySnapshot = productCollection;

    // Filtros
    let query = querySnapshot;
    if (estado) {
      query = query.where('estado', '==', estado);
    }

    // Paginación
    const pageInt = parseInt(page, 5) || 1;
    const limitInt = parseInt(limit, 5) || 5;

    // Obtener el total de documentos
    const totalSnapshot = await query.get();
    const totalDocuments = totalSnapshot.size;
    const totalPages = Math.ceil(totalDocuments / limitInt);

    // Aplicar paginación
    const snapshot = await query
      .orderBy(sortBy, sortOrder === 'asc' ? 'asc' : 'desc')
      .offset((pageInt - 1) * limitInt)
      .limit(limitInt)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: 'No se encontraron productos' });
    }

    const productos = snapshot.docs.map(doc => {
      const data = doc.data();
      let estado;

      if (data.cantidad === 0) {
        estado = 'Agotado';
      } else if (data.cantidad <= data.valorUmbral) {
        estado = 'Poca disponibilidad';
      } else {
        estado = 'Disponible';
      }

      return {
        productId: data.productId,
        nombre: data.nombre,
        precioCompra: data.precioCompra,
        cantidad: `${data.cantidad} ${data.unidad}`,
        valorUmbral: `${data.valorUmbral} ${data.unidad}`,
        fechaCaducidad: data.fechaCaducidad,
        estado,
      };
    });

    res.status(200).json({
      productos,
      page: pageInt,
      limit: limitInt,
      totalPages,
      totalDocuments,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los productos', details: error.message });
  }
});

router.post('/proveedores', async (req, res) => {
  const { productId, nuevoEstado } = req.body;

  try {
    // Llamar a la ruta para actualizar el estado
    const response = await axios.put('http://localhost:3000/actualizarEstado', {
      productId,
      nuevoEstado
    });

    if (response.status === 200) {
      res.status(200).json({ message: 'Estado del producto actualizado correctamente' });
    } else {
      res.status(400).json({ error: 'No se pudo actualizar el estado del producto' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar el estado del producto', details: error.message });
  }
});

router.put('/actualizarEstado', async (req, res) => {
  const { productId, nuevoEstado } = req.body;

  try {
    // Buscar el producto en la colección
    const productSnapshot = await productCollection.where('productId', '==', productId).get();

    if (productSnapshot.empty) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const productRef = productSnapshot.docs[0].ref;

    // Actualizar el estado del producto
    await productRef.update({ estado: nuevoEstado });

    res.status(200).json({ message: 'Estado actualizado correctamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar el estado', details: error.message });
  }
});

router.get('/sumar-cantidades', async (req, res) => {
  try {
    const callProduct = await productCollection.get()

    if (callProduct.empty) {
      return res.status(404).json({ error: 'No se encontraron productos' })
    }

    const totalCantidad = callProduct.docs.reduce((acc, doc) => {
      const data = doc.data()
      return acc + (parseInt(data.cantidad) || 0)
    }, 0)

    res.status(200).json({ totalCantidad })
  } catch (error) {
    res.status(500).json({ error: 'Error al sumar las cantidades', details: error.message })
  }
})

router.get('/calcular-total-dinero', async (req, res) => {
  try {
    const callProduct = await productCollection.get()

    if (callProduct.empty) {
      return res.status(404).json({ error: 'No se encontraron productos' })
    }

    const totalDinero = callProduct.docs.reduce((acc, doc) => {
      const data = doc.data()
      const cantidad = parseInt(data.cantidad) || 0
      const precioCompra = parseFloat(data.precioCompra) || 0
      return acc + (cantidad * precioCompra)
    }, 0)

    res.status(200).json({ totalDinero })
  } catch (error) {
    res.status(500).json({ error: 'Error al calcular el total en dinero', details: error.message })
  }
})

router.get('/contarCategoriasUnicas', async (req, res) => {
  try {
    const productsSnapshot = await productCollection.get()
    const categoriasUnicas = new Set();

    productsSnapshot.forEach(doc => {
      const producto = doc.data()
      if (producto.categoria) {
        categoriasUnicas.add(producto.categoria)
      }
    })
    
    const cantidadCategoriasUnicas = categoriasUnicas.size
    res.status(200).json({ cantidadCategoriasUnicas })
  } catch (error) {
    res.status(500).json({ error: 'Error al contar las categorías', details: error.message })
  }
})

router.get('/lowproductos', async (req, res) => {
  try {
    const callProduct = await productCollection.get()

    if (callProduct.empty) {
      return res.status(404).json({ error: 'No se encontraron productos' })
    }

    const productos = callProduct.docs.map(doc => {
      const data = doc.data()

      return {
        imagenUrl: data.imagenUrl,
        nombre: data.nombre,
        cantidad: data.cantidad,
        unidad: data.unidad,
        valorUmbral: data.valorUmbral,
      }
    })

    const productosFiltrados = productos
      .filter(producto => producto.cantidad <= producto.valorUmbral)
      .slice(0, 2);

    res.status(200).json(productosFiltrados)
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los productos', details: error.message })
  }
})

router.get('/lowproductos-sinLim', async (req, res) => {
  try {
    const callProduct = await productCollection.get()

    if (callProduct.empty) {
      return res.status(404).json({ error: 'No se encontraron productos' })
    }

    const productos = callProduct.docs.map(doc => {
      const data = doc.data()

      return {
        imagenUrl: data.imagenUrl,
        nombre: data.nombre,
        cantidad: data.cantidad,
        unidad: data.unidad,
        valorUmbral: data.valorUmbral,
      }
    })

    const productosFiltrados = productos
      .filter(producto => producto.cantidad <= producto.valorUmbral)

    res.status(200).json(productosFiltrados)
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los productos', details: error.message })
  }
})

router.get('/productosall', async (req, res) => {
  try {
    const callProduct = await productCollection.get()

    if (callProduct.empty) {
      return res.status(404).json({ error: 'No se encontraron productos' })
    }

    const productos = callProduct.docs.map(doc => {
      const data = doc.data()
      let estado

      if (data.cantidad === 0) {
        estado = 'Agotado'
      } else if (data.cantidad <= data.valorUmbral) {
        estado = 'Poca disponibilidad'
      } else {
        estado = 'Disponible'
      }

      return {
        nombre: data.nombre,
        precioCompra: data.precioCompra,
        cantidad: `${data.cantidad} ${data.unidad}`,
        valorUmbral: `${data.valorUmbral} ${data.unidad}`,
        fechaCaducidad: data.fechaCaducidad,
        estado: estado,
      }
    })

    res.status(200).json(productos)
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los productos', details: error.message })
  }
})

router.get('/productosAgotados', async (req, res) => { 
  try {
    const callProduct = await productCollection.get()

    if (callProduct.empty) {
      return res.status(404).json({ error: 'No se encontraron productos' })
    }

    let productosAgotados = 0

    callProduct.docs.forEach(doc => {
      const data = doc.data()
      if (data.cantidad === 0) {
        productosAgotados++
      }
    })

    res.status(200).json({ productosAgotados })
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los productos', details: error.message })
  }
})

router.get('/productosPD', async (req, res) => { 
  try {
    const callProduct = await productCollection.get()

    if (callProduct.empty) {
      return res.status(404).json({ error: 'No se encontraron productos' })
    }

    let productosPD = 0

    callProduct.docs.forEach(doc => {
      const data = doc.data()
      if (data.cantidad <= data.valorUmbral && data.cantidad > 0) {
        productosPD++
      }
    })

    res.status(200).json({ productosPD })
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los productos', details: error.message })
  }
})

router.get('/producto/:productId', async (req, res) => {
  const { productId } = req.params
  try {
    const productSnapshot = await productCollection.where('productId', '==', productId).get()

    if (productSnapshot.empty) {
      return res.status(404).json({ error: 'Producto no encontrado' })
    }

    const callStore = await storeCollection.get()

    if (callStore.empty) {
        return res.status(404).json({ error: 'No se encontraron tiendas' })
    }

    const nombresTiendas = callStore.docs.map(doc => doc.data().nombreTienda);

    const product = productSnapshot.docs[0].data()
    const nombreProducto = product.nombre

    const orderSnapshot = await supplierOrderCollection.where('nombreProducto', '==', nombreProducto).get()
    const supplierSnapshot = await supplierCollection.where('producto', '==', nombreProducto).get()

    let nombreProveedor = "No tienes proveedor"
    let numeroContacto = "No tienes proveedor"
    let cantidadProveedor = 0

    if (!orderSnapshot.empty) {
      cantidadProveedor = orderSnapshot.docs.reduce((sum, doc) => sum + doc.data().cantidad, 0)
    }

    if (!supplierSnapshot.empty) {
      const supplier = supplierSnapshot.docs[0].data()
      nombreProveedor = supplier.nombreProveedor
      numeroContacto = supplier.numeroContacto
    }

    res.json({
      ...product,
      nombresTiendas,
      nombreProveedor,
      numeroContacto,
      cantidadProveedor
    })
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los detalles del producto', details: error.message })
  }
})

router.get('/productoTienda/:productId', async (req, res) => {
  const { productId } = req.params;
  try {
    const productSnapshot = await productCollection.where('productId', '==', productId).get();

    if (productSnapshot.empty) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const callStore = await storeCollection.get();

    if (callStore.empty) {
      return res.status(404).json({ error: 'No se encontraron tiendas' });
    }

    const nombresTiendas = callStore.docs.map(doc => doc.data().nombreTienda);

    let cantidadTotal = 0;

    if (!productSnapshot.empty) {
      cantidadTotal = productSnapshot.docs.map(doc => doc.data().cantidad).reduce((acc, curr) => acc + curr, 0);
    }

    // Dividir la cantidad entre las tiendas
    let cantidadesTiendas = [];
    if (nombresTiendas.length === 1) {
      cantidadesTiendas = [{ tienda: nombresTiendas[0], cantidad: cantidadTotal }];
    } else {
      let cantidadActual = cantidadTotal;
      for (let i = 0; i < nombresTiendas.length; i++) {
        const fraccion = Math.pow(2, i);
        const cantidadAsignada = Math.floor(cantidadTotal / fraccion);
        cantidadesTiendas.push({ tienda: nombresTiendas[i], cantidad: cantidadAsignada });
        cantidadActual -= cantidadAsignada;
      }
    }

    res.json({
      cantidadesTiendas
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los detalles del producto', details: error.message });
  }
});

router.put('/actualizarproducto/:productId', async (req, res) => {
  const { productId } = req.params; // Obtener el productId de los parámetros
  const { fechaCaducidad, precioCompra, valorUmbral } = req.body; // Obtener los campos a actualizar

  try {
    // Validar que el productId no sea vacío
    if (!productId) {
      return res.status(400).json({ error: 'ID del producto es obligatorio' });
    }

    // Buscar el producto por su productId
    const productSnapshot = await productCollection.where('productId', '==', productId).get();

    if (productSnapshot.empty) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    // Obtener el primer documento que coincide (si hay más de uno, tomamos el primero)
    const productDoc = productSnapshot.docs[0];
    const currentData = productDoc.data(); // Obtener los datos actuales del producto

    // Si no se proporciona un valor, usar el valor actual de la base de datos
    const updatedData = {
      fechaCaducidad: fechaCaducidad || currentData.fechaCaducidad,
      precioCompra: precioCompra ? parseFloat(precioCompra) : currentData.precioCompra,
      valorUmbral: valorUmbral ? parseInt(valorUmbral) : currentData.valorUmbral,
    };

    // Actualizar el documento
    await productDoc.ref.update(updatedData);

    res.status(200).json({ message: 'Producto actualizado exitosamente' });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar el producto', details: error.message });
  }
});

router.get('/producto/:productId/ordenes', async (req, res) => {
  const { productId } = req.params;

  try {
    const productSnapshot = await productCollection.where('productId', '==', productId).get();

    if (productSnapshot.empty) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const product = productSnapshot.docs[0].data();
    const nombreProducto = product.nombre;

    const orderSnapshot = await supplierOrderCollection.where('nombreProducto', '==', nombreProducto).get();

    if (orderSnapshot.empty) {
      return res.status(404).json({ error: 'No se encontraron órdenes a proveedores para este producto' });
    }

    const ordenes = orderSnapshot.docs.map(doc => doc.data());

    res.json({ ordenes });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener órdenes a proveedores', details: error.message });
  }
});

router.get('/ordenes/:productId/ordenesCliente', async (req, res) => {
  const { productId } = req.params;

  try {
    const productSnapshot = await productCollection.where('productId', '==', productId).get();

    if (productSnapshot.empty) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    // Obtener el id del producto y buscar las órdenes relacionadas en ordersCollection
    const ordersSnapshot = await ordersCollection.where('productoId', '==', productId).get();

    if (ordersSnapshot.empty) {
      return res.status(404).json({ error: 'No se encontraron órdenes para este producto.' });
    }

    // Formatear los datos de las órdenes
    const ordenClientes = ordersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json({ ordenClientes });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener las órdenes', details: error.message });
  }
});

import moment from 'moment'

router.get('/ordenesPuntos/:productId/ordenesClienteP', async (req, res) => {
  const { productId } = req.params;

  try {
      // Verificar que el producto existe
      const productSnapshot = await productCollection.where('productId', '==', productId).get();
      if (productSnapshot.empty) {
          return res.status(404).json({ error: 'Producto no encontrado' });
      }

      // Obtener las órdenes relacionadas con el producto
      const ordersSnapshot = await ordersCollection.where('productoId', '==', productId).get();
      if (ordersSnapshot.empty) {
          return res.status(404).json({ error: 'No se encontraron órdenes para este producto.' });
      }

      // Calcular las fechas del año actual para filtrar
      const currentDate = new Date();
      const startOfYear = new Date(currentDate.getFullYear(), 0, 1); // Inicio del año actual
      const endOfYear = new Date(currentDate.getFullYear(), 11, 31); // Fin del año actual
      const startOfYearStr = startOfYear.toISOString().split('T')[0];
      const endOfYearStr = endOfYear.toISOString().split('T')[0];

      // Calcular los últimos 30 días
      const now = moment();
      const days = [...Array(30)].map((_, i) => now.clone().subtract(i, 'days'));
      const labels = days.reverse().map((d) => d.format('YYYY-MM-DD'));

      // Inicializar el array de precioPedido
      let precioPedido = Array(30).fill(0);

      // Procesar las órdenes
      ordersSnapshot.forEach((doc) => {
          const order = doc.data();
          const orderDate = new Date(order.fechaEntrega).toISOString().split('T')[0];

          // Verificar que la orden esté dentro del rango del año actual
          if (orderDate >= startOfYearStr && orderDate <= endOfYearStr) {
              const dayIndex = days.findIndex((d) => d.format('YYYY-MM-DD') === orderDate);

              if (dayIndex !== -1) {
                  // Sumar el precio del pedido al día correspondiente
                  precioPedido[dayIndex] += order.precioPedido;
              }
          }
      });

      // Responder con los datos procesados
      res.status(200).json({
          labels,
          precioPedido,
      });
  } catch (error) {
      res.status(500).json({
          error: 'Error al obtener las órdenes del producto',
          details: error.message,
      });
  }
});

export { productCollection }
export default router
