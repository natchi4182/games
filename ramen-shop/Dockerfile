# らーめん開業日誌：静的ファイルを nginx で配信する（fly.io 用）
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /tmp/site
# ads.txt は AdSense の審査後に置く（ads.txt.example を参照）。無ければ飛ばす
RUN cp /tmp/site/index.html /tmp/site/privacy.html /usr/share/nginx/html/ \
 && (cp /tmp/site/ads.txt /usr/share/nginx/html/ 2>/dev/null || true) \
 && rm -rf /tmp/site
EXPOSE 8080
