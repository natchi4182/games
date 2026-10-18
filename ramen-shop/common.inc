# どのアドレスでも共通の設定
gzip on;
gzip_types text/plain text/css application/javascript application/manifest+json image/svg+xml;
include /etc/nginx/conf.d/headers.inc;
location = /manifest.webmanifest { default_type application/manifest+json; try_files $uri =404; }
location = /ads.txt { default_type text/plain; try_files $uri =404; }
