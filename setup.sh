#!/bin/bash
# Crear el directorio si no existe
mkdir -p "$DIR"
cd "$DIR"

# Generar un secreto aleatorio (32 caracteres)
SECRET=$(openssl rand -base64 24)

# Crear el archivo setting.json
cat > setting.json <<EOF
{
    "listen": "0.0.0.0:5000",
    "secret": "$SECRET",
    "logger": true,
    "customize": {
        "websiteURL": "",
        "websiteLogo": "",
        "websiteLogoSize": "128px",
        "disableKillCount": false
    }
}
EOF

# Verificar si los directorios ammo y markers existen
if [ ! -d "$DIR/ammo" ]; then
  mkdir -p "$DIR/ammo"
  echo "Directorio 'ammo' creado."
fi

if [ ! -d "$DIR/markers" ]; then
  mkdir -p "$DIR/markers"
  echo "Directorio 'markers' creado."
fi

# Iniciar el contenedor usando el comando proporcionado
echo "Iniciando el contenedor OCAP..."
docker run --name ocap-web --network bridge --network-alias ocap-web --network pelican_nw -d \
  -p 5000:5000/tcp \
  -e OCAP_SECRET="$SECRET" \
  -v /mnt/Datos/ocap/records:/var/lib/ocap/data \
  -v /mnt/Datos/ocap/maps:/var/lib/ocap/maps \
  -v /mnt/Datos/ocap/database:/var/lib/ocap/db \
  ghcr.io/ocap2/web:latest

# Mostrar el secreto generado
echo "El secreto generado es: $SECRET"
