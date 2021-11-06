APP_NAME = ultrasonics
BRANCH := $(shell git rev-parse --abbrev-ref HEAD)

build:
	@docker build -t $(APP_NAME) .

run:
	docker run --detach --name $(APP_NAME) -p 5000:5000 $(APP_NAME)

tag-latest:
	docker tag $(APP_NAME) xdgfx/$(APP_NAME):latest

tag-branch:
	docker tag $(APP_NAME) xdgfx/$(APP_NAME):$(BRANCH)

push-latest: tag-latest
	docker push xdgfx/$(APP_NAME):latest

push-branch: tag-branch
	docker push xdgfx/$(APP_NAME):$(BRANCH)