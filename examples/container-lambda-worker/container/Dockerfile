FROM public.ecr.aws/lambda/nodejs:22

COPY container-worker.js ${LAMBDA_TASK_ROOT}

CMD [ "container-worker.containerLambdaWorker" ]
