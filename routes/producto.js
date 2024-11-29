import express from 'express'
import { db } from '../firebase.js'
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
  const { nombre, productId, categoria, precioCompra, cantidad, unidad, fechaCaducidad, valorUmbral } = req.body

  try {
    const findProduct = await productCollection.where('productId', '==', productId).get()

    if (!findProduct.empty) {
      return res.status(400).json({ error: 'El ID del producto ya existe' })
    }

    let imagenUrl = null

    if (req.file) {
      imagenUrl = `${req.protocol}://${req.get('host')}/uploads/productos/${req.file.filename}`
    }

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
    })

    res.status(201).json({ message: 'Producto creado exitosamente', imagenUrl })
  } catch (error) {
    res.status(500).json({ error: 'Error al crear el producto', details: error.message })
  }
})

router.get('/productos', async (req, res) => {
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

export { productCollection }
export default router
