import { verifyToken } from './conexion';

export function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({ error: 'No se proporcionó un token.' });
    }

    const token = authHeader.split(' ')[1]; // Extrae el token del encabezado

    try {
        const decoded = verifyToken(token); // Verifica el token
        req.user = { accountId: decoded.accountId }; // Agrega el accountId a la solicitud
        next(); // Continua con la siguiente función
    } catch (error) {
        return res.status(401).json({ error: 'Token no válido o expirado.' });
    }
}
