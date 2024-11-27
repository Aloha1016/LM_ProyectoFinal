import express from 'express'
import { db } from '../firebase.js'
import multer from 'multer'

const router = express.Router()
const storeCollection = db.collection('tienda')

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/tienda/')
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${file.originalname}`
        cb(null, uniqueSuffix)
    },
})

const upload = multer({ storage })

router.post('/creartienda', upload.single('imagen'), async (req, res) => {
    const { nombreTienda, ciudad, codigoPostal, direccion, telefono, idTienda } = req.body;

    try {
        let imagenProUrl = null

        if (req.file) {
            imagenProUrl = `${req.protocol}://${req.get('host')}/uploads/tienda/${req.file.filename}`
        }

        await storeCollection.add({
            nombreTienda,
            ciudad,
            codigoPostal,
            direccion,
            telefono,
            idTienda,
            imagenProUrl,
        })

        res.status(201).json({ message: 'tienda creada exitosamente', imagenProUrl })
    } catch (error) {
        res.status(500).json({ error: 'Error al crear la tienda', details: error.message })
    }
})

router.get('/tiendas', async (req, res) => {
    try {
        const callStore = await storeCollection.get()

        if (callStore.empty) {
            return res.status(404).json({ error: 'No se encontraron tiendas' })
        }

        const tiendas = callStore.docs.map(doc => {
            const data = doc.data()

            return {
                nombreTienda: data.nombreTienda,
                direccion: data.direccion,
                ciudad: `${data.ciudad} ${data.codigoPostal}`,
                telefono: data.telefono,
                idTienda: data.idTienda,
                imagenProUrl: data.imagenProUrl, // Incluimos la URL de la imagen
            }
        })

        res.status(200).json(tiendas);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener las tiendas', details: error.message })
    }
})

router.put('/actualizartienda/:id', upload.single('imagen'), async (req, res) => {
    const { nombreTienda, ciudad, codigoPostal, direccion, telefono } = req.body
    const tiendaId = req.params.id; // Este es el ID que asignas a la tienda

    try {
        // Buscar el documento que tenga el idTienda igual al tiendaId
        const tiendaQuerySnapshot = await storeCollection.where('idTienda', '==', tiendaId).get()

        if (tiendaQuerySnapshot.empty) {
            return res.status(404).json({ error: 'La tienda no existe con ese ID' })
        }

        // Obtener el primer documento (en este caso debería haber solo uno)
        const tiendaDoc = tiendaQuerySnapshot.docs[0]
        const tiendaRef = tiendaDoc.ref

        let updatedFields = {
            nombreTienda,
            ciudad,
            codigoPostal,
            direccion,
            telefono,
        }

        // Si se subió una nueva imagen, actualiza también la URL de la imagen
        if (req.file) {
            const imagenProUrl = `${req.protocol}://${req.get('host')}/uploads/tienda/${req.file.filename}`
            updatedFields.imagenProUrl = imagenProUrl;
        }

        // Actualizar los campos en Firebase
        await tiendaRef.update(updatedFields)

        res.status(200).json({ message: 'Tienda actualizada exitosamente', updatedFields })
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar la tienda', details: error.message })
    }
})

// Ruta para obtener una tienda específica por su idTienda
router.get('/tienda/:idTienda', async (req, res) => {
    const { idTienda } = req.params; // El idTienda se recibe como parámetro de la URL

    try {
        // Realizamos la consulta buscando el idTienda
        const tiendaQuerySnapshot = await storeCollection.where('idTienda', '==', idTienda).get()

        if (tiendaQuerySnapshot.empty) {
            return res.status(404).json({ error: 'No se encontró una tienda con ese ID' })
        }

        // Obtener el primer documento (en este caso debería haber solo uno)
        const tiendaDoc = tiendaQuerySnapshot.docs[0]
        const data = tiendaDoc.data()

        // Devolvemos los datos de la tienda
        const tienda = {
            nombreTienda: data.nombreTienda,
            ciudad: data.ciudad,
            codigoPostal: data.codigoPostal,
            direccion: data.direccion,
            telefono: data.telefono,
            imagenProUrl: data.imagenProUrl, // Incluimos la URL de la imagen
        }

        res.status(200).json(tienda)
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener la tienda', details: error.message })
    }
})

export default router