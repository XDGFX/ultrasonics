app_name = ultrasonics

build:
	@docker build -t $(app_name) .

run:
	docker run --detach --name $(app_name) -p 5000:5000 $(app_name)