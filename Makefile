app_name = ultrasonics

build:
	@docker build -t $(app_name) .

run:
	docker run --detach --name $(app_name) -p 5000:5000 $(app_name)

tag-latest:
	docker tag $(app_name) xdgfx/$(app_name):latest

push-latest:
	docker push xdgfx/$(app_name):latest