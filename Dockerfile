FROM python:3.8.5-alpine

COPY . /
WORKDIR /

VOLUME [ "/config", "/plugins" ]

RUN apk --no-cache add gcc g++ musl-dev
RUN pip install -r requirements.txt

EXPOSE 5000

ENTRYPOINT ["python"]

CMD ["app.py"]
