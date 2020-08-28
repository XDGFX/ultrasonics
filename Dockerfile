FROM python:3.8.5-alpine

COPY . /app
WORKDIR /app

RUN apk --no-cache add gcc musl-dev
RUN pip install -r requirements.txt 

EXPOSE 5000

ENTRYPOINT ["python"]

CMD ["app.py"]
