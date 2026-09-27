FROM mcr.microsoft.com/playwright:v1.62.1-noble

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg sudo \
  && usermod --login node --home /home/node --move-home ubuntu \
  && groupmod --new-name node ubuntu \
  && printf 'node ALL=(root) NOPASSWD:ALL\n' > /etc/sudoers.d/node \
  && chmod 0440 /etc/sudoers.d/node \
  && rm -rf /var/lib/apt/lists/*

USER node
