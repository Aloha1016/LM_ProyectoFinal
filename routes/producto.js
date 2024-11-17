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

export default router
