.PHONY: test test-build test-clean

DOCKER_IMAGE := fill-video-tests

# Build the test image. Nothing is installed on the host — Node, npm
# packages, and browsers all live inside the image.
test-build:
	docker build -f tests/Dockerfile -t $(DOCKER_IMAGE) .

# Run the Playwright regression suite inside Docker.
test: test-build
	docker run --rm $(DOCKER_IMAGE)

# Remove the built test image.
test-clean:
	docker rmi $(DOCKER_IMAGE) 2>/dev/null || true
