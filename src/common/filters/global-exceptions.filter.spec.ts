import { ArgumentsHost, HttpStatus, BadRequestException } from "@nestjs/common";
import { GlobalExceptionsFilter } from "./global-exceptions.filter";

describe("GlobalExceptionsFilter", () => {
  let filter: GlobalExceptionsFilter;
  let mockResponse: any;
  let mockRequest: any;
  let mockHost: ArgumentsHost;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new GlobalExceptionsFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockRequest = {
      id: "req-123",
      method: "GET",
      url: "/auth/reset-password?token=abc",
      originalUrl: "/auth/reset-password?token=abc",
    };
    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    } as unknown as ArgumentsHost;

    loggerErrorSpy = jest.spyOn((filter as any).logger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("a 500 on a URL with ?token=abc never logs 'abc'", () => {
    const error = new Error("Database connection lost");
    filter.catch(error, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mockResponse.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal server error",
    });

    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    const loggedData = loggerErrorSpy.mock.calls[0][0];

    // Assert structured log contains redacted path
    expect(loggedData).toMatchObject({
      reqId: "req-123",
      method: "GET",
      path: "/auth/reset-password?token=[REDACTED]",
      status: 500,
      errorName: "Error",
      message: "Database connection lost",
    });

    // Ensure the raw token 'abc' is nowhere in the logged object
    const serialized = JSON.stringify(loggedData);
    expect(serialized).not.toContain("abc");
  });

  it("maps Multer LIMIT_FILE_SIZE error to HTTP 413 Payload Too Large", () => {
    const multerError = { code: "LIMIT_FILE_SIZE", name: "MulterError" };
    filter.catch(multerError, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        error: "Payload Too Large",
      }),
    );
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it("maps BadRequestException 'File too large' to HTTP 413", () => {
    const badReq = new BadRequestException("File too large");
    filter.catch(badReq, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
      }),
    );
  });
});
