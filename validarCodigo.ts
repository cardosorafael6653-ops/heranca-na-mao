import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Sistema de validação de códigos para o aplicativo Herança na Mão.
 * Valida o formato, a matemática do dígito verificador e previne reutilização.
 * 
 * @param {string} codigoBruto - O código inserido pelo usuário (ex: HNM-140282-9)
 * @returns {object} - { valido: boolean, motivo?: string }
 */
export function validarCodigo(codigoBruto: string): { valido: boolean; motivo?: string } {
    // 1. Normalização
    const codigo = codigoBruto.trim().toUpperCase();

    // 2. Verificação de Formato (HNM-XXXXXX-X)
    const regex = /^HNM-(\d{6})-(\d)$/;
    const match = codigo.match(regex);

    if (!match) {
        return { valido: false, motivo: "formato invalido" };
    }

    const numeros = match[1]; // Os 6 dígitos centrais
    const digitoInformado = parseInt(match[2]);

    // 3. Recálculo do Dígito Verificador
    // Algoritmo: (Soma(digito * peso) % 11) % 10
    const pesos = [3, 5, 7, 9, 3, 5];
    let soma = 0;
    for (let i = 0; i < numeros.length; i++) {
        soma += parseInt(numeros[i]) * pesos[i];
    }
    const digitoCalculado = (soma % 11) % 10;

    // 4. Validação Matemática
    if (digitoCalculado !== digitoInformado) {
        return { valido: false, motivo: "codigo invalido" };
    }

    // --- Prevenção de Reutilização ---

    const usedCodesPath = path.join(process.cwd(), 'used_codes.json');
    const licenseLockPath = path.join(process.cwd(), 'license.lock');
    const codigoHash = crypto.createHash('sha256').update(codigo).digest('hex');

    // Inicializar arquivos se não existirem
    if (!fs.existsSync(usedCodesPath)) {
        fs.writeFileSync(usedCodesPath, JSON.stringify({ codes: [] }, null, 2));
    }
    if (!fs.existsSync(licenseLockPath)) {
        fs.writeFileSync(licenseLockPath, '');
    }

    // 5. Verificar used_codes.json
    try {
        const usedData = JSON.parse(fs.readFileSync(usedCodesPath, 'utf8'));
        if (usedData.codes.includes(codigo)) {
            return { valido: false, motivo: "codigo ja utilizado" };
        }
    } catch (e) {
        // Se o JSON estiver corrompido, ignoramos e seguimos para a trava de segurança (lock)
    }

    // 6. Verificar license.lock (Trava de segurança via Hash)
    const lockContent = fs.readFileSync(licenseLockPath, 'utf8');
    if (lockContent.includes(codigoHash)) {
        return { valido: false, motivo: "codigo ja utilizado" };
    }

    // --- Registro de Uso ---

    // Registrar no used_codes.json
    try {
        const usedData = JSON.parse(fs.readFileSync(usedCodesPath, 'utf8'));
        usedData.codes.push(codigo);
        fs.writeFileSync(usedCodesPath, JSON.stringify(usedData, null, 2));
    } catch (e) {
        // Caso o JSON falhe, o lock ainda garantirá a segurança
    }

    // Registrar no license.lock (append do hash)
    fs.appendFileSync(licenseLockPath, codigoHash + '\n');

    return { valido: true };
}
